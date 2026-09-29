import { supabaseServer } from '@/lib/supabase';
import { workerUrl } from '@/lib/worker';

/**
 * Shared ingestion core.
 *
 * BOTH entry points — the browser's file upload (`POST /api/upload`) and the
 * server-side YouTube downloader (`POST /api/ingest-url`) — funnel through
 * `createVideoFromStorage` and `triggerVideoPipeline` here. There is exactly
 * one storage write, one `videos` row shape, and one pipeline trigger, which
 * is what makes the two paths converge instead of drifting apart.
 *
 * Server-only. Never import this from a client component: it reaches for the
 * service-role client and the internal service key.
 */

/** Fallback per-object ceiling when the bucket has no explicit `file_size_limit`. */
const DEFAULT_STORAGE_LIMIT = 50 * 1024 * 1024; // 50 MiB

/**
 * App-level ceiling on the request body, independent of storage.
 *
 * This is NOT the limit the user actually faces: the effective limit returned
 * to the browser is `min(app, storage)`, which for the current Supabase plan
 * is 50 MB. The 2 GB value only matters once storage can accept it. Large-file
 * support is pending a chunked-storage architecture.
 */
const DEFAULT_APP_LIMIT = 2 * 1024 * 1024 * 1024;

export const VIDEOS_BUCKET = 'videos';

export type IngestErrorCode =
  | 'UNAUTHORIZED'
  | 'NO_FILE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'MEDIA_TOO_LARGE'
  | 'EMPTY_BODY'
  | 'STORAGE_UPLOAD_FAILED'
  | 'STORAGE_UPLOAD_TIMEOUT'
  | 'DATABASE_INSERT_FAILED'
  | 'PIPELINE_TRIGGER_FAILED'
  | 'INTERNAL_ERROR';

/** A rejection the caller should surface verbatim — never a raw exception. */
export class IngestError extends Error {
  readonly code: IngestErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: IngestErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** The app-level ceiling (2 GB by default); the real cap is min(app, storage). */
export function appUploadLimit(): number {
  return positiveIntFromEnv('UPLOAD_MAX_BYTES', DEFAULT_APP_LIMIT);
}

/**
 * The ceiling that will actually be accepted when the bytes reach Supabase.
 *
 * A bucket with `file_size_limit = null` inherits the project's plan limit,
 * which is 50 MiB on the free tier — a 434 MB "successful" upload is not
 * physically possible there, and the Storage API refuses to raise the bucket
 * above the plan ceiling. Reading the real number up front lets us reject
 * oversized files in milliseconds instead of after the browser has spent
 * minutes pushing the body.
 */
export function storageUploadLimit(): number {
  return positiveIntFromEnv('STORAGE_MAX_BYTES', DEFAULT_STORAGE_LIMIT);
}

let cachedStorageLimit: { value: number; at: number } | null = null;

/**
 * Effective limit = min(app cap, storage cap). Cached briefly because it costs
 * a network round trip and it cannot change meaningfully between requests.
 */
export async function effectiveUploadLimit(): Promise<number> {
  if (cachedStorageLimit && Date.now() - cachedStorageLimit.at < 60_000) {
    return Math.min(appUploadLimit(), cachedStorageLimit.value);
  }
  let limit = storageUploadLimit();
  try {
    const supabase = supabaseServer();
    const { data } = await supabase.storage.getBucket(VIDEOS_BUCKET);
    const bucketLimit = (data as { file_size_limit?: number | null } | null)
      ?.file_size_limit;
    if (typeof bucketLimit === 'number' && bucketLimit > 0) {
      limit = bucketLimit;
      cachedStorageLimit = { value: limit, at: Date.now() };
    } else if (data) {
      // Bucket exists with no explicit limit -> the project default applies.
      cachedStorageLimit = { value: limit, at: Date.now() };
    }
  } catch {
    // Keep the conservative default when the lookup fails; the Storage API is
    // the real authority and will still reject anything too large.
  }
  return Math.min(appUploadLimit(), limit);
}

export interface UploadLimits {
  maxBytes: number;
  appMaxBytes: number;
  storageMaxBytes: number;
}

export async function uploadLimits(): Promise<UploadLimits> {
  return {
    maxBytes: await effectiveUploadLimit(),
    appMaxBytes: appUploadLimit(),
    storageMaxBytes: storageUploadLimit(),
  };
}

/** Reject an over-sized body with a message the UI can show as-is. */
export function assertWithinLimit(
  bytes: number,
  limits: UploadLimits
): void {
  if (bytes <= limits.maxBytes) return;
  const tooBig = (bytes / (1024 * 1024)).toFixed(1);
  const cap = (limits.maxBytes / (1024 * 1024)).toFixed(0);
  const which =
    limits.storageMaxBytes < limits.appMaxBytes
      ? `This Supabase project stores at most ${cap} MB per video (project Storage limit).`
      : `Uploads are capped at ${cap} MB.`;
  throw new IngestError(
    'MEDIA_TOO_LARGE',
    `File is ${tooBig} MB, which is over the ${cap} MB limit. ${which}`,
    413,
    { sizeBytes: bytes, maxBytes: limits.maxBytes, appMaxBytes: limits.appMaxBytes, storageMaxBytes: limits.storageMaxBytes }
  );
}

/** `[^\w.-]` -> `_`, no path separators, never empty, always length-bounded. */
export function sanitizeFileName(name: string): string {
  const base = (name || '').split(/[\\/]/).pop() || '';
  let safe = base.replace(/[^\w.-]/g, '_').replace(/^\.+/, '');
  if (!safe) safe = 'video.mp4';
  if (safe.length > 100) {
    const dot = safe.lastIndexOf('.');
    const ext = dot > 0 && safe.length - dot <= 10 ? safe.slice(dot) : '';
    safe = safe.slice(0, 100 - ext.length) + ext;
  }
  return safe;
}

/**
 * `{userId}/{timestamp}-{sanitizedName}` — the exact shape the storage RLS
 * policies require (first path segment must equal the owner's uid) and the
 * shape a normal upload already produces.
 */
export function storagePathFor(userId: string, fileName: string): string {
  return `${userId}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

export interface StoredVideo {
  id: string;
  user_id: string;
  title: string;
  storage_path: string;
  status: string;
  processing_stage: string;
  original_url?: string | null;
}

/**
 * Write the media to the private `videos` bucket, create the `videos` row, and
 * return it. Shared by both ingestion paths so the resulting record is
 * byte-for-byte the same shape regardless of where the media came from.
 */
export async function createVideoFromStorage(params: {
  userId: string;
  title: string;
  storagePath: string;
  /** File bytes to upload, or a local path to stream from disk. */
  body: Blob | ReadableStream<Uint8Array> | string;
  contentType?: string;
  originalUrl?: string | null;
  /**
   * Reuse a row that was already created as a reservation (the server-side
   * importer creates one before it starts downloading, so a duplicate request
   * for the same URL can be deduplicated). Omitted by the browser upload path,
   * which inserts exactly as it always did.
   */
  existingVideoId?: string;
  /**
   * Optional hard ceiling on the storage write. Omitted by the browser upload
   * path (which streams from the client and is bounded by the request itself);
   * set by the server-side importer, whose download has already consumed most of
   * its request budget.
   */
  timeoutMs?: number;
}): Promise<StoredVideo> {
  const { userId, title, storagePath, body, contentType, originalUrl } =
    params;
  const supabase = supabaseServer();

  const write = supabase.storage
    .from(VIDEOS_BUCKET)
    .upload(storagePath, body as BodyInit, {
      cacheControl: '3600',
      upsert: false,
      contentType,
    });

  let uploadOutcome: {
    data: { path: string } | null;
    error: { message: string } | null;
  };
  if (params.timeoutMs && params.timeoutMs > 0) {
    // Without this the route could outlive its own deadline and be killed by
    // the platform, which the caller sees as a bare 502 with no cleanup.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new IngestError(
            'STORAGE_UPLOAD_TIMEOUT',
            'The video was downloaded but storing it took too long, so nothing was saved. Check your library, then try again.',
            504
          )
        );
      }, params.timeoutMs);
    });
    try {
      uploadOutcome = await Promise.race([write, expiry]);
    } catch (error) {
      // Best effort: the row was never created, so a partially written object
      // would be unreachable garbage in the bucket.
      void supabase.storage
        .from(VIDEOS_BUCKET)
        .remove([storagePath])
        .then(() => undefined, () => undefined);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } else {
    uploadOutcome = await write;
  }

  const { error: uploadError } = uploadOutcome;

  if (uploadError) {
    // Supabase reports an over-size object as a 413. Translate it into the
    // same structured error a pre-flight check would have produced.
    const isTooLarge =
      /exceeded the maximum allowed size|EntityTooLarge|413/i.test(
        uploadError.message
      );
    throw new IngestError(
      isTooLarge ? 'MEDIA_TOO_LARGE' : 'STORAGE_UPLOAD_FAILED',
      isTooLarge
        ? 'The video is larger than this Supabase project can store per object.'
        : `Could not store the video: ${uploadError.message}`,
      isTooLarge ? 413 : 502,
      isTooLarge ? undefined : { storageError: uploadError.message }
    );
  }

  if (params.existingVideoId) {
    // The reservation row becomes the video row: same id, so a duplicate
    // request that was already handed this id keeps pointing at real content.
    const { data: video, error: updateError } = await supabase
      .from('videos')
      .update({
        title,
        storage_path: storagePath,
        status: 'processing',
        processing_stage: 'queued',
        original_url: originalUrl ?? null,
        error_message: null,
      })
      .eq('id', params.existingVideoId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError || !video) {
      await supabase.storage
        .from(VIDEOS_BUCKET)
        .remove([storagePath])
        .catch(() => undefined);
      throw new IngestError(
        'DATABASE_INSERT_FAILED',
        `Could not attach the video to its import: ${updateError?.message ?? 'unknown error'}`,
        500,
        { dbError: updateError?.message }
      );
    }

    return video as StoredVideo;
  }

  const { data: video, error: insertError } = await supabase
    .from('videos')
    .insert({
      user_id: userId,
      title,
      storage_path: storagePath,
      status: 'processing',
      // The worker writes every later stage; 'queued' is the honest starting
      // point for a job that has been accepted but not picked up yet.
      processing_stage: 'queued',
      original_url: originalUrl ?? null,
    })
    .select()
    .single();

  if (insertError || !video) {
    // Do not leave an orphaned object behind if the row could not be created.
    await supabase.storage
      .from(VIDEOS_BUCKET)
      .remove([storagePath])
      .catch(() => undefined);
    throw new IngestError(
      'DATABASE_INSERT_FAILED',
      `Could not create the video record: ${insertError?.message ?? 'unknown error'}`,
      500,
      { dbError: insertError?.message }
    );
  }

  return video as StoredVideo;
}

export interface TriggerResult {
  triggered: boolean;
  endpoint: string;
  reason?: string;
  status?: number;
}

/**
 * Kick the EXISTING pipeline for a video, server-to-server, with the internal
 * service key. Same mechanism for both ingestion paths.
 */
export async function triggerVideoPipeline(
  videoId: string
): Promise<TriggerResult> {
  const appUrl = (process.env.KRIX_APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(
    /\/$/,
    ''
  );
  const endpoint = workerUrl() ? '/api/pipeline/process' : '/api/process-video';
  const serviceKey = process.env.INTERNAL_SERVICE_KEY || '';

  if (!appUrl) {
    return {
      triggered: false,
      endpoint,
      reason:
        'Neither KRIX_APP_URL nor NEXT_PUBLIC_APP_URL is set, so the pipeline could not be called.',
    };
  }
  if (!serviceKey) {
    return {
      triggered: false,
      endpoint,
      reason: 'INTERNAL_SERVICE_KEY is not set, so the pipeline call was refused.',
    };
  }

  try {
    const res = await fetch(`${appUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-key': serviceKey,
      },
      body: JSON.stringify({ videoId }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        triggered: false,
        endpoint,
        status: res.status,
        reason:
          (body as { message?: string })?.message ||
          `The pipeline endpoint returned ${res.status}.`,
      };
    }
    return { triggered: true, endpoint, status: res.status };
  } catch (error) {
    return {
      triggered: false,
      endpoint,
      reason:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'The pipeline endpoint did not answer within 30s.'
          : 'Could not reach the pipeline endpoint.',
    };
  }
}
