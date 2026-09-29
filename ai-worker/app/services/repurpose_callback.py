"""
Worker → Next.js callback: fire ``POST /api/repurpose`` once clips are stored.

Design constraints:

* **Server-to-server only.** The worker sends the shared ``INTERNAL_SERVICE_KEY``
  as ``x-service-key``. It never accepts a key from a request body, so a user can
  never make the worker call an arbitrary URL or supply their own secret.
* **Idempotent.** The callback is safe to repeat. ``/api/repurpose`` deletes the
  previous rows for a video before inserting, and this module additionally
  serialises repeated calls for the same video id inside the worker process, so
  a retried completion cannot create duplicate content.
* **Never fatal.** A repurposing failure must not turn a successfully rendered
  video into a failed one — the clips are already stored, so the error is
  recorded and returned, not raised.
"""

from __future__ import annotations

import threading
import time

from app import config as cfg

# One in-flight callback per video id, so a duplicate completion cannot race.
_inflight: dict[str, threading.Lock] = {}
_inflight_guard = threading.Lock()


def _lock_for(video_id: str) -> threading.Lock:
    with _inflight_guard:
        lock = _inflight.get(video_id)
        if lock is None:
            lock = threading.Lock()
            _inflight[video_id] = lock
        if len(_inflight) > 64:
            for key, value in list(_inflight.items()):
                if key != video_id and not value.locked():
                    del _inflight[key]
                    break
        return lock


def trigger_repurpose(video_id: str, *, user_id: str | None = None) -> dict:
    """Ask the Next.js app to generate the text assets for ``video_id``.

    Returns a result dict; never raises for an expected failure.
    """
    if not cfg.REPURPOSE_ON_COMPLETE:
        return {"triggered": False, "reason": "REPURPOSE_ON_COMPLETE is disabled"}
    if not cfg.INTERNAL_SERVICE_KEY:
        return {
            "triggered": False,
            "reason": "INTERNAL_SERVICE_KEY is not set in the worker; "
            "set it to the same value as the Next.js app to enable auto-repurposing",
        }

    url = f"{cfg.APP_BASE_URL}/api/repurpose"
    lock = _lock_for(video_id)
    if not lock.acquire(timeout=cfg.REPURPOSE_TIMEOUT):
        return {"triggered": False, "reason": "another repurposing call is still running"}
    try:
        import httpx

        started = time.time()
        with httpx.Client(timeout=cfg.REPURPOSE_TIMEOUT) as client:
            response = client.post(
                url,
                json={"videoId": video_id},
                headers={
                    "Content-Type": "application/json",
                    "x-service-key": cfg.INTERNAL_SERVICE_KEY,
                },
            )
        elapsed = round(time.time() - started, 2)
        if response.status_code >= 400:
            return {
                "triggered": False,
                "status": response.status_code,
                "reason": f"{url} returned {response.status_code}",
                "detail": response.text[:500],
                "seconds": elapsed,
            }
        return {"triggered": True, "status": response.status_code, "seconds": elapsed}
    except Exception as exc:  # noqa: BLE001 - never fail a completed video
        return {
            "triggered": False,
            "reason": f"Could not reach {url}: {exc}",
        }
    finally:
        lock.release()
