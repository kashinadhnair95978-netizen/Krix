import { createReadStream } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/auth-utils';
import {
  IngestError,
  assertWithinLimit,
  createVideoFromStorage,
  storagePathFor,
  triggerVideoPipeline,
  uploadLimits,
} from '@/lib/ingest';
import {
  type ImportRow,
  classifyImport,
  decideDuplicate,
  listImports,
  markImportFailed,
  markImportStaged,
  releaseImportLock,
  reserveImport,
  retryCooldownSeconds,
  staleImportSeconds,
  supersedeStaleImport,
  tryAcquireImportLock,
} from '@/lib/ingest-dedupe';
import {
  IngestUrlError,
  downloadDurationLimit,
  downloadSizeLimit,
  downloadTimeoutMs,
  downloadYoutubeVideo,
  importBudgetMs,
  normalizeYouTubeUrl,
  remainingBudgetMs,
} from '@/lib/ytdlp';

export const runtime = 'nodejs';
// The download runs inline so the caller gets the real outcome; the heavy AI
// pipeline is still started asynchronously afterwards. `importBudgetMs()` is
// deliberately smaller than this ceiling so the handler always answers with a
// structured error instead of being killed and surfacing as a bare 502.
export const maxDuration = 300;

/** Minimum wall-clock left for the storage write + pipeline trigger. */
const FINALISE_RESERVE_MS = 15_000;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof IngestUrlError) {
    return NextResponse.json(
      {
        success: false,
        error: error.code,
        message: error.message,
        ...(error.details ?? {}),
      },
      { status: error.status }
    );
  }
  if (error instanceof IngestError) {
    return NextResponse.json(
      {
        success: false,
        error: error.code,
        message: error.message,
        ...(error.details ?? {}),
      },
      { status: error.status }
    );
  }
  console.error('ingest-url error:', error);
  return NextResponse.json(
    {
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'The link could not be imported. Nothing was stored — please try again.',
    },
    { status: 500 }
  );
}

/**
 * The deterministic answer to a duplicate import: the existing job, never a
 * second download. `state` only changes the wording — the status code stays 200
 * so a client can treat a duplicate exactly like a fresh success.
 */
function existingImportResponse(
  row: ImportRow,
  canonical: string,
  state: 'active' | 'completed' | 'failed',
  reason: string,
  retryAfter?: number
): NextResponse {
  return NextResponse.json(
    {
      success: true,
      deduplicated: true,
      duplicateState: state,
      videoId: row.id,
      status: row.status ?? (state === 'completed' ? 'completed' : 'processing'),
      processingStage: row.processing_stage,
      storagePath: row.storage_path,
      originalUrl: row.original_url ?? canonical,
      importedAt: row.created_at,
      ...(state === 'failed' && row.error_message
        ? { lastError: row.error_message }
        : {}),
      ...(typeof retryAfter === 'number' ? { retryAfterSeconds: retryAfter } : {}),
      message: reason,
    },
    { status: 200 }
  );
}

export async function POST(req: NextRequest) {
  let cleanup: (() => Promise<void>) | null = null;
  let lockKey: string | null = null;
  let reservationId: string | null = null;
  const deadlineAt = Date.now() + importBudgetMs();

  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'UNAUTHORIZED', message: 'Unauthorized' },
        { status: 401 }
      );
    }

    let body: { url?: unknown; force?: unknown };
    try {
      body = (await req.json()) as { url?: unknown; force?: unknown };
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'YOUTUBE_INVALID_URL',
          message: 'A JSON body with a "url" field is required.',
        },
        { status: 400 }
      );
    }

    if (typeof body.url !== 'string' || !body.url.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: 'YOUTUBE_INVALID_URL',
          message: 'Paste a YouTube video link to import.',
        },
        { status: 400 }
      );
    }

    // Normalizes every accepted URL shape onto one canonical form. Anything
    // that is not a single YouTube video is rejected here, before the
    // downloader is involved at all.
    const { id: videoKey, url: canonical } = normalizeYouTubeUrl(body.url);
    const force = body.force === true;
    lockKey = `${userId}:${canonical}`;

    // ---------------------------------------------------------------------
    // Duplicate handling, in two layers.
    //
    // Layer 1 (in-memory, this process) closes the millisecond window between
    // two simultaneous POSTs: the second one is answered immediately with the
    // running job instead of waiting for the first download.
    // ---------------------------------------------------------------------
    if (!tryAcquireImportLock(lockKey)) {
      const inFlight = (await listImports(userId, canonical))[0] ?? null;
      if (inFlight) {
        return existingImportResponse(
          inFlight,
          canonical,
          classifyImport(inFlight),
          'This link is already being imported — showing the running job.'
        );
      }
      // The holder has not written its row yet. Answer deterministically
      // instead of queueing behind it.
      return NextResponse.json(
        {
          success: true,
          deduplicated: true,
          duplicateState: 'downloading',
          videoId: null,
          status: 'processing',
          processingStage: 'downloading',
          originalUrl: canonical,
          message:
            'This link is already being imported right now. Open your library in a moment to see it.',
        },
        { status: 202 }
      );
    }

    // ---------------------------------------------------------------------
    // Layer 2 (database) is authoritative and survives restarts: a completed
    // import is returned, an in-flight import is returned, and a recent failure
    // is returned instead of being retried in a loop.
    // ---------------------------------------------------------------------
    let existing: ImportRow[];
    try {
      existing = await listImports(userId, canonical);
    } catch (lookupError) {
      console.error('ingest-url duplicate lookup failed:', lookupError);
      throw new IngestError(
        'INTERNAL_ERROR',
        'Could not check whether this link was already imported. Nothing was downloaded — please try again.',
        503
      );
    }

    const decision = decideDuplicate(existing, { force });
    if (decision.action === 'return-existing' && decision.row) {
      return existingImportResponse(
        decision.row,
        canonical,
        decision.state ?? 'active',
        decision.reason,
        decision.retryAfterSeconds
      );
    }
    if (decision.supersede) {
      await supersedeStaleImport(decision.supersede, userId);
    }

    // ---------------------------------------------------------------------
    // New import. The row is created BEFORE the download so that a duplicate
    // request arriving during the download finds it and is deduplicated.
    // ---------------------------------------------------------------------
    const limits = await uploadLimits();
    // Never download more than storage can hold, and never start a download we
    // already know cannot be stored.
    const maxBytes = Math.min(downloadSizeLimit(), limits.maxBytes);
    const maxDurationSeconds = downloadDurationLimit();

    const reservedStoragePath = storagePathFor(userId, `youtube-${videoKey}.mp4`);
    let reserved: { id: string };
    try {
      reserved = await reserveImport({
        userId,
        canonicalUrl: canonical,
        title: `YouTube ${videoKey}`,
        storagePath: reservedStoragePath,
      });
    } catch (reserveError) {
      console.error('ingest-url reservation failed:', reserveError);
      throw new IngestError(
        'DATABASE_INSERT_FAILED',
        'Could not start the import: the video record could not be created. Nothing was downloaded — please try again.',
        500
      );
    }
    reservationId = reserved.id;

    let media;
    try {
      media = await downloadYoutubeVideo({
        id: videoKey,
        url: canonical,
        maxBytes,
        maxDurationSeconds,
        deadlineAt,
      });
    } catch (downloadError) {
      // The reservation must not be left looking "in progress" or every later
      // request for this URL would be deduplicated onto a job that is dead.
      const message =
        downloadError instanceof IngestUrlError
          ? downloadError.message
          : 'The video could not be downloaded.';
      await markImportFailed(reservationId, message);
      reservationId = null;
      throw downloadError;
    }
    cleanup = media.cleanup;

    if (remainingBudgetMs(deadlineAt) <= FINALISE_RESERVE_MS) {
      // The download consumed the whole budget. Fail this attempt cleanly
      // instead of starting a storage write that cannot finish.
      const message =
        'The download used the whole time budget for this import, so it was not stored. Check your library, then try again.';
      await markImportFailed(reservationId, message);
      reservationId = null;
      throw new IngestUrlError('DOWNLOAD_TIMEOUT', message, 504, {
        budgetMs: importBudgetMs(),
      });
    }

    assertWithinLimit(media.bytes, limits);

    const title = (media.title || `YouTube ${videoKey}`).slice(0, 200);
    // Same path shape as a browser upload: {userId}/{timestamp}-{sanitized}
    const fileName = `youtube-${videoKey}.${media.containerExtension || 'mp4'}`;
    const storagePath = storagePathFor(userId, fileName);

    const video = await createVideoFromStorage({
      userId,
      title,
      storagePath,
      body: createReadStream(media.filePath) as unknown as ReadableStream<Uint8Array>,
      contentType: 'video/mp4',
      originalUrl: canonical,
      existingVideoId: reservationId,
      timeoutMs: Math.max(5_000, remainingBudgetMs(deadlineAt) - 5_000),
    });

    if (media.durationSeconds != null) {
      await markImportStaged(video.id, { durationSeconds: media.durationSeconds });
    }

    // Identical downstream path to a normal upload: the same pipeline trigger.
    const trigger = await triggerVideoPipeline(video.id);
    // The import itself succeeded; the worker owns the row from here.
    reservationId = null;

    if (!trigger.triggered) {
      return NextResponse.json(
        {
          success: true,
          videoId: video.id,
          status: 'processing',
          storagePath: video.storage_path,
          originalUrl: canonical,
          pipelineTriggered: false,
          message: `Video imported, but processing could not start: ${trigger.reason}`,
        },
        { status: 202 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        videoId: video.id,
        status: 'processing',
        storagePath: video.storage_path,
        originalUrl: canonical,
        durationSeconds: media.durationSeconds,
        hasAudio: media.hasAudio,
        bytes: media.bytes,
        pipelineTriggered: true,
      },
      { status: 201 }
    );
  } catch (error) {
    if (reservationId) {
      const message =
        error instanceof IngestError || error instanceof IngestUrlError
          ? error.message
          : 'The import did not finish.';
      await markImportFailed(reservationId, message).catch(() => undefined);
    }
    return errorResponse(error);
  } finally {
    if (cleanup) await cleanup();
    if (lockKey) releaseImportLock(lockKey);
  }
}

/**
 * GET /api/ingest-url — what the client needs before it shows the "paste a
 * link" box: which providers are actually supported, and the size/duration
 * ceilings, so an import that cannot possibly succeed is caught up front.
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'UNAUTHORIZED', message: 'Unauthorized' },
      { status: 401 }
    );
  }
  const limits = await uploadLimits();
  return NextResponse.json({
    success: true,
    providers: ['youtube'],
    maxBytes: Math.min(downloadSizeLimit(), limits.maxBytes),
    maxDurationSeconds: downloadDurationLimit(),
    timeoutMs: downloadTimeoutMs(),
    requestBudgetMs: importBudgetMs(),
    duplicatePolicy: {
      // Documented so the behaviour is not a surprise: a URL is imported once
      // per user, and repeats return the existing job.
      inFlight: 'return-running-job',
      completed: 'return-existing-video',
      failed: `return-failed-job-for-${retryCooldownSeconds()}s-then-retry`,
      staleAfterSeconds: staleImportSeconds(),
      force: 'body {"force": true} starts a fresh import',
    },
  });
}
