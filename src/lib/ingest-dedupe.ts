import { supabaseServer } from '@/lib/supabase';

/**
 * Duplicate-import control for the server-side YouTube importer.
 *
 * A local browser upload arrives with its bytes already in hand, so importing
 * the same file twice is the user's explicit choice. A URL import is different:
 * the server downloads the video, and the duplicate check used to run *after*
 * nothing had been recorded, so a repeat POST started a second full download of
 * a video that was already imported. That is what produced the observed
 * behaviour — a multi-minute stall and a 502 (or no video row at all) for a URL
 * that was already in the library.
 *
 * The rules implemented here make that path deterministic:
 *
 *  1. A successfully ingested video for the same canonical URL is RETURNED, not
 *     re-downloaded (`200`, `deduplicated: true`).
 *  2. An import that is still running is RETURNED, so a concurrent second POST
 *     never starts a second download of the same video.
 *  3. A failed import is returned while it is inside a short cooldown, and only
 *     retried afterwards (or with `force: true`), so repeated clicks cannot
 *     hammer the downloader.
 *  4. An import that is stuck in a non-terminal state forever (a server that was
 *     killed mid-download) is treated as stale after `INGEST_STALE_SECONDS` and
 *     may be retried.
 *  5. The `videos` row is created BEFORE the download starts, so the duplicate
 *     check has something to find during the very first seconds of an import —
 *     and so a duplicate request has a real `videoId` to return.
 *
 * Ownership is unchanged: every read is scoped with `.eq('user_id', userId)`
 * and every write sets `user_id`, exactly like the rest of the ingestion path.
 * The browser upload path (`POST /api/upload`) does not use this module.
 */

export type ImportState = 'active' | 'completed' | 'failed';

export interface ImportRow {
  id: string;
  user_id?: string;
  title: string | null;
  status: string | null;
  processing_stage: string | null;
  storage_path: string | null;
  original_url: string | null;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const COLUMNS =
  'id, user_id, title, status, processing_stage, storage_path, original_url, error_message, created_at, updated_at';

function numFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** How long a `processing` row is trusted as genuinely in flight. */
export function staleImportSeconds(): number {
  return numFromEnv('INGEST_STALE_SECONDS', 30 * 60);
}

/** How long a failed import is returned instead of retried automatically. */
export function retryCooldownSeconds(): number {
  return numFromEnv('INGEST_RETRY_COOLDOWN_SECONDS', 10 * 60);
}

function ms(value: string | null | undefined): number {
  if (!value) return NaN;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Terminal-vs-not from BOTH columns, because historical rows are inconsistent
 * (`status = 'failed'` with `processing_stage = 'queued'`, and vice versa).
 * Either column saying `completed` means the pipeline finished; either saying
 * `failed` means it did not.
 */
export function classifyImport(row: ImportRow): ImportState {
  const status = (row.status || '').toLowerCase();
  const stage = (row.processing_stage || '').toLowerCase();
  if (status === 'completed' || stage === 'completed') return 'completed';
  if (status === 'failed' || stage === 'failed') return 'failed';
  return 'active';
}

/** A row stuck in a non-terminal state past its deadline can be retried. */
export function isStaleImport(row: ImportRow, now = Date.now()): boolean {
  if (classifyImport(row) !== 'active') return false;
  const last = ms(row.updated_at) || ms(row.created_at);
  if (!Number.isFinite(last)) return true;
  return now - last > staleImportSeconds() * 1000;
}

/** Seconds until a failed import may be retried automatically (0 = now). */
export function retryAfterSeconds(row: ImportRow, now = Date.now()): number {
  const last = ms(row.updated_at) || ms(row.created_at) || now;
  const remaining = last + retryCooldownSeconds() * 1000 - now;
  return remaining <= 0 ? 0 : Math.ceil(remaining / 1000);
}

/** Every import this user has for one canonical URL, newest first. */
export async function listImports(
  userId: string,
  canonicalUrl: string
): Promise<ImportRow[]> {
  const { data, error } = await supabaseServer()
    .from('videos')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('original_url', canonicalUrl)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    // A lookup failure must not silently become "no duplicate found" and
    // therefore a second download. Surface it as an ingestion error instead.
    throw new Error(`duplicate lookup failed: ${error.message}`);
  }
  return (data ?? []) as ImportRow[];
}

export interface DuplicateDecision {
  action: 'return-existing' | 'new-import';
  row: ImportRow | null;
  state: ImportState | null;
  reason: string;
  retryAfterSeconds?: number;
  /** A stuck row that must be retired before the new import starts. */
  supersede: ImportRow | null;
}

/**
 * Decide what a repeat import must do. Pure enough to reason about: given the
 * rows that exist for this URL, either an existing job is returned or a new
 * import is started. It never waits.
 */
export function decideDuplicate(
  rows: ImportRow[],
  opts: { force?: boolean; now?: number } = {}
): DuplicateDecision {
  const now = opts.now ?? Date.now();
  const force = opts.force === true;
  const latest = rows[0] ?? null;

  if (!force) {
    // 1. An import that is genuinely in flight wins: never start a second
    //    download of the same video.
    if (latest && classifyImport(latest) === 'active' && !isStaleImport(latest, now)) {
      return {
        action: 'return-existing',
        row: latest,
        state: 'active',
        reason: 'This link is already being imported — showing the running job.',
        supersede: null,
      };
    }

    // 2. A successful import of the same video is the answer. Re-downloading it
    //    would cost another full download to produce the same record.
    const completed = rows.find((r) => classifyImport(r) === 'completed');
    if (completed) {
      return {
        action: 'return-existing',
        row: completed,
        state: 'completed',
        reason: 'This video is already in your library — showing the existing import.',
        supersede: null,
      };
    }

    // 3. A recent failure is returned instead of being retried in a loop.
    if (latest && classifyImport(latest) === 'failed') {
      const wait = retryAfterSeconds(latest, now);
      if (wait > 0) {
        return {
          action: 'return-existing',
          row: latest,
          state: 'failed',
          retryAfterSeconds: wait,
          reason: `The last import of this link failed. You can retry in ${wait}s (or pass force: true).`,
          supersede: null,
        };
      }
    }
  }

  // 4. Nothing usable, the previous attempt is past its cooldown, or the caller
  //    explicitly forced a fresh import. A stuck row is retired by the caller so
  //    it stops shadowing later attempts.
  const stuck = latest && classifyImport(latest) === 'active' && isStaleImport(latest, now) ? latest : null;

  return {
    action: 'new-import',
    row: null,
    state: null,
    reason: force ? 'A fresh import was explicitly requested.' : 'No usable import for this link.',
    supersede: stuck,
  };
}

/** Retire a stuck row so it stops shadowing later attempts. */
export async function supersedeStaleImport(row: ImportRow, userId: string): Promise<void> {
  await supabaseServer()
    .from('videos')
    .update({
      status: 'failed',
      processing_stage: 'failed',
      processing_ended_at: new Date().toISOString(),
      error_message: 'Import did not finish and was superseded by a new attempt.',
    })
    .eq('id', row.id)
    .eq('user_id', userId)
    .then(() => undefined, () => undefined);
}

/**
 * Create the `videos` row BEFORE the download starts.
 *
 * This is the reservation that makes duplicate detection work while the first
 * import is still downloading: the row exists within milliseconds, so a second
 * POST for the same URL finds it instead of starting a parallel download. If the
 * download then fails, the row is marked failed (see `markImportFailed`) rather
 * than being deleted, so the attempt stays visible and rate-limited.
 */
export async function reserveImport(params: {
  userId: string;
  canonicalUrl: string;
  title: string;
  storagePath: string;
}): Promise<{ id: string; storage_path: string | null }> {
  const { userId, canonicalUrl, title, storagePath } = params;
  const { data, error } = await supabaseServer()
    .from('videos')
    .insert({
      user_id: userId,
      title,
      storage_path: storagePath,
      status: 'processing',
      processing_stage: 'queued',
      original_url: canonicalUrl,
    })
    .select('id, storage_path')
    .single();

  if (error || !data) {
    throw new Error(`could not create the import record: ${error?.message ?? 'unknown error'}`);
  }
  return data as { id: string; storage_path: string | null };
}

/** Attach the real media details once the download has been validated. */
export async function markImportStaged(
  videoId: string,
  patch: { title?: string; storagePath?: string; durationSeconds?: number | null }
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.title) update.title = patch.title;
  if (patch.storagePath) update.storage_path = patch.storagePath;
  if (typeof patch.durationSeconds === 'number' && Number.isFinite(patch.durationSeconds)) {
    update.duration_seconds = Math.round(patch.durationSeconds);
  }
  if (Object.keys(update).length === 0) return;

  await supabaseServer()
    .from('videos')
    .update(update)
    .eq('id', videoId)
    .then(() => undefined, () => undefined);
}

/** Terminal failure for a reserved row, so it stops looking "in progress". */
export async function markImportFailed(videoId: string, message: string): Promise<void> {
  await supabaseServer()
    .from('videos')
    .update({
      status: 'failed',
      processing_stage: 'failed',
      processing_ended_at: new Date().toISOString(),
      error_message: message.slice(0, 2000),
    })
    .eq('id', videoId)
    .then(() => undefined, () => undefined);
}

/* -------------------------------------------------------------------------- */
/* In-process single-flight guard                                              */
/* -------------------------------------------------------------------------- */

/**
 * `POST /api/ingest-url` handles the download inline, so two requests that
 * arrive microseconds apart would both pass the database check before either
 * has inserted its row. This closes that window.
 *
 * The lock is deliberately NON-blocking: if it is already held the caller
 * returns a duplicate response immediately instead of waiting. That is what
 * removes the possibility of a queue of requests each waiting on a download.
 * Every holder has a TTL and must release in a `finally`, so a request that dies
 * mid-download cannot wedge the URL permanently.
 */
const locks = new Map<string, number>();

export function lockTtlMs(): number {
  return numFromEnv('INGEST_LOCK_TTL_SECONDS', 20 * 60) * 1000;
}

export function tryAcquireImportLock(key: string, now = Date.now()): boolean {
  for (const [k, expiresAt] of locks) {
    if (expiresAt <= now) locks.delete(k);
  }
  if (locks.has(key)) return false;
  locks.set(key, now + lockTtlMs());
  return true;
}

export function releaseImportLock(key: string): void {
  locks.delete(key);
}
