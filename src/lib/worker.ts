/**
 * Server-only helper for talking to the AI worker (FastAPI) service.
 *
 * The browser NEVER calls the worker directly — every call goes through a
 * Next.js API route which enforces the internal service key, then the route
 * calls this module with the shared `AI_WORKER_API_KEY` bearer token.
 */

interface WorkerVideo {
  id: string;
  user_id: string;
  storage_path: string;
  title?: string | null;
}

export function workerUrl(): string | null {
  const url = (process.env.AI_WORKER_URL || '').replace(/\/$/, '');
  return url || null;
}

export function workerApiKey(): string {
  return process.env.AI_WORKER_API_KEY || '';
}

/**
 * Kick off the full AI pipeline for a video. Returns `triggered: false`
 * (without throwing) when the worker is not configured, so the rest of the
 * app can fall back to the older in-app processing path.
 */
export async function triggerPipeline(
  video: WorkerVideo
): Promise<{ triggered: boolean; reason?: string; detail?: unknown }> {
  const url = workerUrl();
  if (!url) {
    return { triggered: false, reason: 'AI_WORKER_URL is not configured' };
  }

  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerApiKey()}`,
      },
      body: JSON.stringify({
        video_id: video.id,
        user_id: video.user_id,
        storage_path: video.storage_path,
        title: video.title ?? null,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        triggered: false,
        reason: `Worker rejected the pipeline request (${res.status})`,
        detail: body,
      };
    }

    return { triggered: true };
  } catch (error) {
    return {
      triggered: false,
      reason: 'Could not reach the AI worker',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}