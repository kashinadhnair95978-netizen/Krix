import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/auth-utils';
import {
  IngestError,
  VIDEOS_BUCKET,
  assertWithinLimit,
  createVideoFromStorage,
  storagePathFor,
  triggerVideoPipeline,
  uploadLimits,
} from '@/lib/ingest';

// Route handlers run on the Node runtime so the request body can be streamed
// and the service-role client can be used.
export const runtime = 'nodejs';
// Long enough for a large body plus the storage write; the client also has its
// own timeout so a stalled request surfaces as an error rather than a hang.
export const maxDuration = 300;

const ALLOWED_EXTENSIONS = new Set([
  'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpeg', 'mpg', 'wmv', 'flv', '3gp',
]);
const ALLOWED_MIME_PREFIXES = ['video/'];
const ALLOWED_MIME_EXACT = new Set(['application/mp4', 'application/octet-stream']);

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

/**
 * Accept anything that is plausibly a video container.
 *
 * Browsers are inconsistent about the MIME type they report for `.mov`/`.mkv`
 * and some report `application/octet-stream`, so the extension is the
 * authoritative signal and the MIME type is only allowed to veto when it is
 * present and clearly not a media type.
 */
function isAcceptableMedia(file: File): boolean {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  const type = (file.type || '').toLowerCase();
  if (!type) return true;
  if (ALLOWED_MIME_EXACT.has(type)) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => type.startsWith(p));
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof IngestError) {
    return NextResponse.json(
      { success: false, error: error.code, message: error.message, ...(error.details ?? {}) },
      { status: error.status }
    );
  }
  console.error('Upload error:', error);
  return NextResponse.json(
    {
      success: false,
      error: 'INTERNAL_ERROR',
      message:
        'The upload could not be completed. Nothing was stored — please try again.',
    },
    { status: 500 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'UNAUTHORIZED', message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const limits = await uploadLimits();

    // Reject an over-sized body from the Content-Length header BEFORE parsing
    // it. `req.formData()` buffers the entire multipart body in memory, so
    // without this check an oversized upload is downloaded in full, held in
    // the heap, and only then rejected — which is what made a 434 MB file sit
    // on "Uploading..." for minutes with no result.
    const declaredLength = Number(req.headers.get('content-length') || '0');
    if (Number.isFinite(declaredLength) && declaredLength > 0) {
      // Multipart framing adds a small, bounded overhead on top of the file.
      // Check against the raw file size cap only: the storage limit applies to
      // the stored object, not the multipart envelope.
      assertWithinLimit(declaredLength, limits);
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'EMPTY_BODY',
          message:
            'The upload body could not be read. The connection may have dropped mid-transfer — please try again.',
        },
        { status: 400 }
      );
    }

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'NO_FILE',
          message:
            'No video file was received. Please pick a video and try again.',
        },
        { status: 400 }
      );
    }

    if (!isAcceptableMedia(file)) {
      return NextResponse.json(
        {
          success: false,
          error: 'UNSUPPORTED_MEDIA_TYPE',
          message: `Unsupported file type "${file.type || extensionOf(file.name)}". Upload an MP4, MOV or WebM video.`,
        },
        { status: 415 }
      );
    }

    assertWithinLimit(file.size, limits);

    const title = (
      (formData.get('title') as string | null) ||
      file.name.replace(/\.[^.]+$/, '') ||
      'Untitled video'
    ).slice(0, 200);

    const storagePath = storagePathFor(userId, file.name);

    // Read the File into a stream so the bytes are handed to the storage
    // client without a second full copy in the JS heap.
    const video = await createVideoFromStorage({
      userId,
      title,
      storagePath,
      body: file.stream() as unknown as ReadableStream<Uint8Array>,
      contentType: file.type || 'video/mp4',
      originalUrl: null,
    });

    const trigger = await triggerVideoPipeline(video.id);

    if (!trigger.triggered) {
      // The video row exists and the media is stored, so this is a partial
      // success, not a failure. Say so explicitly instead of silently leaving
      // the row stuck on "processing" forever.
      return NextResponse.json(
        {
          success: true,
          videoId: video.id,
          status: 'processing',
          storagePath: video.storage_path,
          pipelineTriggered: false,
          message: `Video stored, but processing could not start: ${trigger.reason}`,
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
        pipelineTriggered: true,
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * GET /api/upload — the limits the client needs to fail fast instead of
 * streaming a file that cannot possibly be stored.
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
    maxBytes: limits.maxBytes,
    maxMegabytes: Math.floor(limits.maxBytes / (1024 * 1024)),
    appMaxBytes: limits.appMaxBytes,
    storageMaxBytes: limits.storageMaxBytes,
    bucket: VIDEOS_BUCKET,
  });
}
