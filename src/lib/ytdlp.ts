import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Server-side remote-video ingestion.
 *
 * The browser never downloads a remote video — it only ever posts a URL to
 * `POST /api/ingest-url`, and every byte is fetched here, on the server, with
 * yt-dlp. The downloader is invoked through `spawn` with an argument array and
 * `shell: false`, so nothing a user types is ever interpreted by a shell.
 *
 * The URL is additionally constrained to a strict allowlist of YouTube hosts
 * plus an exact 11-character video id, which is what stops a "paste a link"
 * box from being usable as an SSRF primitive (no `file://`, no `http://
 * localhost`, no internal addresses ever reach the downloader).
 */

export type IngestUrlErrorCode =
  | 'YOUTUBE_INVALID_URL'
  | 'YOUTUBE_UNSUPPORTED_PROVIDER'
  | 'YOUTUBE_UNAVAILABLE'
  | 'YOUTUBE_PRIVATE'
  | 'YOUTUBE_AGE_RESTRICTED'
  | 'YOUTUBE_GEO_BLOCKED'
  | 'YOUTUBE_RATE_LIMITED'
  | 'YOUTUBE_DOWNLOAD_FAILED'
  | 'YOUTUBE_NO_MEDIA'
  | 'MEDIA_TOO_LARGE'
  | 'MEDIA_TOO_LONG'
  | 'MEDIA_INVALID'
  | 'DOWNLOADER_UNAVAILABLE'
  | 'DOWNLOADER_MISCONFIGURED'
  | 'DOWNLOAD_TIMEOUT'
  | 'PROBE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class IngestUrlError extends Error {
  readonly code: IngestUrlErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: IngestUrlErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'IngestUrlError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/* -------------------------------------------------------------------------- */
/* URL validation and normalization                                          */
/* -------------------------------------------------------------------------- */

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/** A YouTube video id is exactly 11 characters of the URL-safe alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Accepts the URL shapes a user actually pastes (watch, youtu.be, shorts,
 * embed, live) and returns the canonical video id. Returns `null` for anything
 * that is not a single YouTube video, including playlists and channel URLs.
 */
export function extractYouTubeId(raw: string): string | null {
  let value = (raw || '').trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    // Bare host like "youtu.be/abc" is a common paste.
    value = `https://${value}`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (url.username || url.password) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const paramId = url.searchParams.get('v');

  if (host.endsWith('youtu.be')) {
    const id = segments[0];
    return id && segments.length === 1 && VIDEO_ID.test(id) ? id : null;
  }
  if (paramId && VIDEO_ID.test(paramId)) {
    // A watch URL with extra path segments is still a single video.
    if (segments.length === 0) return paramId;
    if (segments[0] === 'watch') return paramId;
    if (['shorts', 'embed', 'live', 'v'].includes(segments[0])) {
      return segments[1] && VIDEO_ID.test(segments[1]) ? segments[1] : null;
    }
    return null;
  }
  if (['shorts', 'embed', 'live', 'v'].includes(segments[0] ?? '')) {
    const id = segments[1];
    return id && VIDEO_ID.test(id) ? id : null;
  }
  return null;
}

/** The single canonical form used for duplicate detection. */
export function canonicalYouTubeUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function normalizeYouTubeUrl(raw: string): {
  id: string;
  url: string;
} {
  const id = extractYouTubeId(raw);
  if (!id) {
    throw new IngestUrlError(
      'YOUTUBE_INVALID_URL',
      'That does not look like a YouTube video link. Paste a link like https://www.youtube.com/watch?v=…',
      400
    );
  }
  return { id, url: canonicalYouTubeUrl(id) };
}

/* -------------------------------------------------------------------------- */
/* Binary resolution                                                          */
/* -------------------------------------------------------------------------- */

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate yt-dlp: the configured path first, then the project's own Python venv
 * (documented in DEVELOPMENT.md), then PATH.
 */
export async function resolveYtDlp(): Promise<string | null> {
  const configured = (process.env.YTDLP_PATH || '').trim();
  if (configured) {
    if (await exists(configured)) return configured;
    throw new IngestUrlError(
      'DOWNLOADER_UNAVAILABLE',
      `YTDLP_PATH is set to "${configured}" but no such file exists.`,
      500
    );
  }

  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const candidates = [
    path.join(process.cwd(), 'ai-worker', '.venv', 'Scripts', exe),
    path.join(process.cwd(), 'ai-worker', '.venv', 'bin', 'yt-dlp'),
    exe,
  ];
  for (const c of candidates) {
    if (path.isAbsolute(c)) {
      if (await exists(c)) return c;
      continue;
    }
    // Bare name: rely on spawn's PATH resolution, but confirm it is callable
    // by asking the OS where it lives.
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      if (!dir) continue;
      const full = path.join(dir, exe);
      if (await exists(full)) return full;
    }
  }
  return null;
}

export async function resolveFfprobe(): Promise<string | null> {
  const configured = (process.env.FFPROBE_PATH || '').trim();
  if (configured) {
    if (await exists(configured)) return configured;
    throw new IngestUrlError(
      'PROBE_UNAVAILABLE',
      `FFPROBE_PATH is set to "${configured}" but no such file exists.`,
      500
    );
  }
  const exe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, exe);
    if (await exists(full)) return full;
  }
  return null;
}

/**
 * Optional cookie arguments.
 *
 * YouTube challenges unrecognised (typically datacenter) IPs with a
 * "Sign in to confirm you're not a bot" wall, which no format selector can get
 * past. Operators can supply either a Netscape-format `cookies.txt` or a local
 * browser profile so imports keep working:
 *
 *   YTDLP_COOKIES_FILE=/etc/krix/youtube-cookies.txt
 *   YTDLP_COOKIES_FROM_BROWSER=chrome          (or "chrome:Profile 1", "firefox")
 *
 * Cookies are only ever read on the server; the values never reach the browser.
 */
async function cookieArgs(): Promise<string[]> {
  const file = (process.env.YTDLP_COOKIES_FILE || '').trim();
  const browser = (process.env.YTDLP_COOKIES_FROM_BROWSER || '').trim();
  if (file) {
    if (!(await exists(file))) {
      throw new IngestUrlError(
        'DOWNLOADER_MISCONFIGURED',
        'YTDLP_COOKIES_FILE points to a file that does not exist on the server.',
        500
      );
    }
    return ['--cookies', file];
  }
  if (browser) {
    return ['--cookies-from-browser', browser];
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

function numFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Hard ceiling on the downloaded file, independent of the storage bucket. */
export function downloadSizeLimit(): number {
  return numFromEnv('INGEST_MAX_BYTES', 50 * 1024 * 1024);
}

/** Hard ceiling on the source video's duration, in seconds. */
export function downloadDurationLimit(): number {
  return numFromEnv('INGEST_MAX_DURATION_SECONDS', 90 * 60);
}

export function downloadTimeoutMs(): number {
  return numFromEnv('INGEST_TIMEOUT_SECONDS', 15 * 60) * 1000;
}

/**
 * Wall-clock budget for the WHOLE import request (download ladder + storage
 * write + pipeline trigger).
 *
 * It is deliberately smaller than the route's `maxDuration`, so the handler
 * always gets to answer with a structured `DOWNLOAD_TIMEOUT` instead of being
 * killed by the platform and surfacing as a bare 502. This is what stops a slow
 * or wedged download from turning into an indefinite browser wait.
 */
export function importBudgetMs(): number {
  return numFromEnv('INGEST_REQUEST_BUDGET_SECONDS', 4 * 60) * 1000;
}

/** Time left before the budget is gone; never negative. */
export function remainingBudgetMs(deadlineAt: number, now = Date.now()): number {
  return Math.max(0, deadlineAt - now);
}

/* -------------------------------------------------------------------------- */
/* Process execution                                                          */
/* -------------------------------------------------------------------------- */

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run a binary with an argument array. `shell` is false (the default), so the
 * arguments are passed to the process directly and are never re-parsed.
 */
function run(
  bin: string,
  args: string[],
  timeoutMs: number
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      reject(e);
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 4_000_000) stdout = stdout.slice(-4_000_000);
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Error classification                                                       */
/* -------------------------------------------------------------------------- */

const UNAVAILABLE = [
  'video unavailable',
  'this video is unavailable',
  'video has been removed',
  'removed by the uploader',
  'account associated with this video has been terminated',
  'this video is no longer available',
  'video is private',
  'this video is private',
  'please sign in to confirm your age',
  'confirm your age',
  'members-only',
  'join this channel',
  'video unavailable in your country',
  'not available in your country',
  'blocked it in your country',
  'who has blocked it in your country',
  'requested format is not available',
  'unable to extract',
  'unable to download webpage',
  'http error 404',
  'no video formats found',
];

/**
 * Map yt-dlp's stderr onto a stable application error code. The raw stderr is
 * never returned to the browser — it can contain extractor internals, tokens
 * and signed media URLs.
 */
function classifyDownloadFailure(stderr: string): IngestUrlError {
  const s = stderr.toLowerCase();
  const hit = (needle: string) => s.includes(needle);

  if (hit('sign in to confirm your age') || hit('age-restricted')) {
    return new IngestUrlError(
      'YOUTUBE_AGE_RESTRICTED',
      'That video is age-restricted and cannot be imported.',
      422
    );
  }
  if (
    hit("sign in to confirm you're not a bot") ||
    hit('confirm you are not a bot') ||
    hit('cookies-from-browser') ||
    hit('use --cookies') ||
    hit('too many requests') ||
    hit('http error 429')
  ) {
    return new IngestUrlError(
      'YOUTUBE_RATE_LIMITED',
      "YouTube is rate-limiting or challenge-verifying this server's IP, so the video could not be fetched. Try again in a few minutes, or upload the file directly.",
      429
    );
  }
  if (
    hit('video is private') ||
    hit('private video') ||
    hit('sign in if you\'ve been granted access') ||
    hit('members-only') ||
    hit('join this channel')
  ) {
    return new IngestUrlError(
      'YOUTUBE_PRIVATE',
      'That video is private or members-only. Only public videos can be imported.',
      422
    );
  }
  if (
    hit('not available in your country') ||
    hit('blocked it in your country') ||
    hit('who has blocked it in your country')
  ) {
    return new IngestUrlError(
      'YOUTUBE_GEO_BLOCKED',
      'That video is not available from this server\'s region.',
      422
    );
  }
  if (hit('requested format is not available') || hit('no video formats found')) {
    return new IngestUrlError(
      'YOUTUBE_NO_MEDIA',
      'No downloadable video stream was offered for that video.',
      422
    );
  }
  if (hit('is too large') || hit('filesize') && hit('exceed')) {
    return new IngestUrlError(
      'MEDIA_TOO_LARGE',
      'That video is larger than the import size limit.',
      413
    );
  }
  if (UNAVAILABLE.some((n) => hit(n))) {
    return new IngestUrlError(
      'YOUTUBE_UNAVAILABLE',
      'That video is unavailable, deleted, or restricted.',
      422
    );
  }
  return new IngestUrlError(
    'YOUTUBE_DOWNLOAD_FAILED',
    'The video could not be downloaded. It may be private, deleted, region-locked, or temporarily unavailable.',
    502
  );
}

/* -------------------------------------------------------------------------- */
/* Download                                                                   */
/* -------------------------------------------------------------------------- */

export interface DownloadedMedia {
  filePath: string;
  bytes: number;
  title: string | null;
  durationSeconds: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  containerExtension: string;
  cleanup: () => Promise<void>;
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'krix-ingest-'));
}

function rmDir(dir: string): Promise<void> {
  return fs
    .rm(dir, { recursive: true, force: true })
    .catch(() => undefined);
}

/**
 * Download one YouTube video into a fresh temp directory, validate it with
 * ffprobe, and hand back a file the caller can stream to storage. The temp
 * directory is always removed by the caller's `finally`.
 */
export async function downloadYoutubeVideo(params: {
  id: string;
  url: string;
  maxBytes: number;
  maxDurationSeconds: number;
  /**
   * Absolute epoch-ms deadline for the whole import. When present, the format
   * ladder stops as soon as it is spent and the caller gets a 504 instead of a
   * request that never answers.
   */
  deadlineAt?: number;
}): Promise<DownloadedMedia> {
  const { url, maxBytes, maxDurationSeconds, deadlineAt } = params;

  const ytdlp = await resolveYtDlp();
  if (!ytdlp) {
    throw new IngestUrlError(
      'DOWNLOADER_UNAVAILABLE',
      'yt-dlp is not installed on the server, so link import is unavailable. Install it with "pip install yt-dlp" (or set YTDLP_PATH) and try again. File upload still works.',
      503
    );
  }
  const ffprobe = await resolveFfprobe();
  if (!ffprobe) {
    throw new IngestUrlError(
      'PROBE_UNAVAILABLE',
      'ffprobe was not found on the server, so the downloaded video cannot be validated. Install FFmpeg or set FFPROBE_PATH.',
      503
    );
  }

  const dir = await makeTempDir();
  const cleanup = () => rmDir(dir);
  const outTpl = path.join(dir, 'source.%(ext)s');

  // The AI pipeline cannot work without an audio track, so every selector
  // demands one. Passes walk a resolution ladder from best to worst so the
  // download lands under `maxBytes` whenever any rendition of the video fits.
  // H.264 is preferred for worker clip-rendering compatibility, with AV1/VP9
  // accepted as a fallback.
  //
  // Two hard-won details:
  //  1. A hand-written chain that does not require audio will happily return a
  //     video-only AV1 stream, which then fails inside the worker's audio
  //     extraction - so the audio requirement is enforced here AND verified
  //     with ffprobe before the file is accepted.
  //  2. `--max-filesize` makes yt-dlp *skip* an over-sized stream and still
  //     exit 0, leaving a truncated `source.f137.mp4` fragment on disk. Those
  //     fragments must never be mistaken for a complete download.
  const FORMAT_PASSES = [
    'bestvideo[height<=1080][vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]',
    'bestvideo[height<=720][vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]',
    'bestvideo[height<=480]+bestaudio/best[height<=480]',
    'best[height<=360]',
  ];

  let lastError: IngestUrlError | null = null;

  for (const format of FORMAT_PASSES) {
    // Time left for this attempt. The whole ladder shares one budget, so a
    // video that needs every rendition pass cannot outlive the request.
    const attemptMs = deadlineAt
      ? remainingBudgetMs(deadlineAt) - 5_000
      : downloadTimeoutMs();
    if (attemptMs < 5_000) {
      await cleanup();
      throw new IngestUrlError(
        'DOWNLOAD_TIMEOUT',
        'The download did not finish in time and was cancelled. Check your library — if the video is already there, nothing was lost.',
        504,
        { budgetMs: importBudgetMs() }
      );
    }

    const attempt = await attemptDownload({
      ytdlp,
      ffprobe,
      dir,
      outTpl,
      url,
      format,
      maxBytes,
      maxDurationSeconds,
      deadlineAt,
      runTimeoutMs: Math.min(attemptMs, downloadTimeoutMs()),
    });
    if (attempt.ok) return { ...attempt.media, cleanup };
    lastError = attempt.error;
    // Only a rendition problem is worth retrying with a different selector: a
    // missing audio stream, a format the ladder should retry smaller, or a
    // rendition that is too large. Every other failure (unavailable, private,
    // rate-limited) would fail identically on the next pass.
    if (!RETRYABLE_DOWNLOAD_ERRORS.has(attempt.error.code)) {
      await cleanup();
      throw attempt.error;
    }
    // A spent budget is not retryable: the caller gets the timeout, not a
    // second identical attempt.
    if (attempt.error.code === 'DOWNLOAD_TIMEOUT') {
      await cleanup();
      throw attempt.error;
    }
    // Clear anything the failed pass left behind before trying again - in
    // particular the truncated per-stream fragments.
    for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
      await fs.rm(path.join(dir, f), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  await cleanup();
  throw (
    lastError ??
    new IngestUrlError(
      'YOUTUBE_NO_MEDIA',
      'No downloadable video with an audio track was found for that video.',
      502
    )
  );
}

/** Failures that a different (smaller/differently muxed) rendition can fix. */
const RETRYABLE_DOWNLOAD_ERRORS = new Set<string>([
  'MEDIA_INVALID',
  'YOUTUBE_NO_MEDIA',
  'MEDIA_TOO_LARGE',
]);

type AttemptResult =
  | { ok: true; media: Omit<DownloadedMedia, 'cleanup'> }
  | { ok: false; error: IngestUrlError };

async function attemptDownload(opts: {
  ytdlp: string;
  ffprobe: string;
  dir: string;
  outTpl: string;
  url: string;
  format: string;
  maxBytes: number;
  maxDurationSeconds: number;
  runTimeoutMs: number;
  deadlineAt?: number;
}): Promise<AttemptResult> {
  const {
    ytdlp,
    ffprobe,
    dir,
    outTpl,
    url,
    format,
    maxBytes,
    maxDurationSeconds,
    runTimeoutMs,
    deadlineAt,
  } = opts;

  // Resolved outside the try so a misconfigured cookie setting surfaces with
  // its own error code instead of being reported as a downloader crash.
  const cookies = await cookieArgs();

  const args = [
    // Never read the operator's personal yt-dlp config: it could add output
    // templates, post-processors or exec hooks we do not control.
    '--ignore-config',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--no-cache-dir',
    '--no-part',
    '--retries',
    '2',
    '--socket-timeout',
    '30',
    // Refuse anything above the byte budget before it is fetched.
    '--max-filesize',
    String(maxBytes),
    '--match-filter',
    `duration < ${maxDurationSeconds}`,
    '--print-json',
    '--no-simulate',
    '-f',
    format,
    '--merge-output-format',
    'mp4',
    '-o',
    outTpl,
    url,
  ];

  let result: RunResult;
  try {
    result = await run(ytdlp, [...args, ...cookies], runTimeoutMs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    return {
      ok: false,
      error: new IngestUrlError(
        code === 'ENOENT' ? 'DOWNLOADER_UNAVAILABLE' : 'YOUTUBE_DOWNLOAD_FAILED',
        code === 'ENOENT'
          ? 'yt-dlp could not be started on the server.'
          : 'The downloader could not be started.',
        502
      ),
    };
  }

  if (result.timedOut) {
    return {
      ok: false,
      error: new IngestUrlError(
        'DOWNLOAD_TIMEOUT',
        'The download took too long and was cancelled.',
        504
      ),
    };
  }

  // yt-dlp's own stderr is the only place it explains *why* something failed.
  const stderr = result.stderr || '';
  const jsonStart = result.stdout.indexOf('{');
  let meta: { title?: string; duration?: number } | null = null;
  if (jsonStart !== -1) {
    try {
      meta = JSON.parse(result.stdout.slice(jsonStart));
    } catch {
      meta = null;
    }
  }
  if (result.code !== 0) {
    if (/duration|too long|Duration too/i.test(stderr)) {
      return {
        ok: false,
        error: new IngestUrlError(
          'MEDIA_TOO_LONG',
          `That video is longer than the ${Math.round(maxDurationSeconds / 60)} minute import limit.`,
          413
        ),
      };
    }
    if (/exceeds the max-filesize|File is larger than|max-filesize/i.test(stderr)) {
      return {
        ok: false,
        error: new IngestUrlError(
          'MEDIA_TOO_LARGE',
          'That video is larger than the import size limit.',
          413
        ),
      };
    }
    if (/requested format is not available|format is not available/i.test(stderr)) {
      // This selector has nothing to offer; another pass may.
      return {
        ok: false,
        error: new IngestUrlError(
          'YOUTUBE_NO_MEDIA',
          'No downloadable video with an audio track was found for that video.',
          502
        ),
      };
    }
    return { ok: false, error: classifyDownloadFailure(stderr) };
  }

  // yt-dlp reports oversize/violation reasons on stderr but may still exit 0
  // (for example when `--max-filesize` merely skips one stream of a merged
  // format). Those are real failures and must not be treated as success.
  if (/exceeds the max-filesize|File is larger than|max-filesize/i.test(stderr)) {
    return {
      ok: false,
      error: new IngestUrlError(
        'MEDIA_TOO_LARGE',
        'That rendition is larger than the import size limit.',
        413
      ),
    };
  }

  // Locate the produced file. A *complete* merged download is written as
  // `source.<ext>`. Per-stream fragments look like `source.f137.mp4` /
  // `source.f140.m4a` and, when `--max-filesize` aborts mid-transfer, a
  // truncated `source.f137.mp4` can be left behind while yt-dlp still exits 0.
  // Only an exact `source.<ext>` counts, so a partial fragment is never
  // uploaded to storage as if it were the whole video.
  const produced = (await fs.readdir(dir).catch(() => [] as string[])).filter(
    (f) => f.startsWith('source.') && !f.endsWith('.part')
  );
  const mediaFile = produced.find((f) =>
    /^source\.(mp4|m4v|webm|mkv|mov)$/i.test(f)
  );
  if (!mediaFile) {
    return {
      ok: false,
      error: new IngestUrlError(
        'YOUTUBE_NO_MEDIA',
        'The downloader produced no complete video file.',
        502
      ),
    };
  }
  const filePath = path.join(dir, mediaFile);
  const stat = await fs.stat(filePath);

  if (stat.size === 0) {
    return {
      ok: false,
      error: new IngestUrlError('YOUTUBE_NO_MEDIA', 'The downloaded video was empty.', 502),
    };
  }
  if (stat.size > maxBytes) {
    return {
      ok: false,
      error: new IngestUrlError(
        'MEDIA_TOO_LARGE',
        'That video is larger than the import size limit.',
        413
      ),
    };
  }

  // Validate the actual media with ffprobe, bounded by the request budget so a
  // wedged probe cannot outlive the deadline either.
  const probeMs = deadlineAt
    ? Math.min(60_000, Math.max(2_000, remainingBudgetMs(deadlineAt) - 2_000))
    : 60_000;
  const probe = await run(
    ffprobe,
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    probeMs
  ).catch(() => null);

  if (!probe || probe.code !== 0) {
    return {
      ok: false,
      error: new IngestUrlError(
        'MEDIA_INVALID',
        'The downloaded file is not a readable video.',
        422
      ),
    };
  }

  let parsed: {
    format?: { duration?: string };
    streams?: { codec_type?: string }[];
  };
  try {
    parsed = JSON.parse(probe.stdout);
  } catch {
    return {
      ok: false,
      error: new IngestUrlError(
        'MEDIA_INVALID',
        'The downloaded file could not be parsed as media.',
        422
      ),
    };
  }

  const streams = parsed.streams ?? [];
  const hasVideo = streams.some((s) => s.codec_type === 'video');
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  if (!hasVideo) {
    return {
      ok: false,
      error: new IngestUrlError(
        'MEDIA_INVALID',
        'The downloaded file contains no video stream.',
        422
      ),
    };
  }
  // The AI pipeline transcribes the audio track; a silent video cannot
  // produce clips. This is retried with a different selector before failing.
  if (!hasAudio) {
    return {
      ok: false,
      error: new IngestUrlError(
        'MEDIA_INVALID',
        'No audio track could be downloaded for that video, so it cannot be processed.',
        422
      ),
    };
  }

  const durationSeconds = Number(parsed.format?.duration ?? meta?.duration ?? 0) || null;
  if (durationSeconds != null && durationSeconds > maxDurationSeconds) {
    return {
      ok: false,
      error: new IngestUrlError(
        'MEDIA_TOO_LONG',
        `That video is ${Math.round(durationSeconds / 60)} minutes long, over the ${Math.round(maxDurationSeconds / 60)} minute import limit.`,
        413
      ),
    };
  }

  return {
    ok: true,
    media: {
      filePath,
      bytes: stat.size,
      title: typeof meta?.title === 'string' ? meta.title : null,
      durationSeconds,
      hasVideo,
      hasAudio,
      containerExtension: path.extname(mediaFile).replace('.', '').toLowerCase(),
    },
  };
}

export { createReadStream };
