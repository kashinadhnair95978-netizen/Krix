'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { GeneratedClip, ClipCandidate } from '@/types';
import { useInterval } from '@/lib/hooks';
import { useToast } from '@/components/ui/Toast';

function candidateOf(clip: GeneratedClip): ClipCandidate | null {
  const c = clip.clip_candidates;
  if (!c) return null;
  return Array.isArray(c) ? c[0] || null : (c as ClipCandidate);
}

function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return '–';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function rangeLabel(start: number, end: number): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function GeneratedClips({ videoId }: { videoId: string }) {
  const [clips, setClips] = useState<GeneratedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const fetchClips = useCallback(async () => {
    try {
      const response = await apiClient.getGeneratedClips(videoId);
      setClips(response.data.clips || []);
      setError('');
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError(err.response?.data?.message || 'Failed to load clips');
      }
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    fetchClips();
  }, [fetchClips]);

  useInterval(fetchClips, clips.length === 0 ? 8000 : null);

  if (loading && clips.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-500">
        Checking for AI clips…
      </div>
    );
  }

  if (clips.length === 0) {
    if (error) {
      return <div className="text-sm text-red-300">{error}</div>;
    }
    return (
      <div className="py-8 text-center text-neutral-500">
        <div className="mb-2 text-4xl">🎬</div>
        <p className="text-sm">
          No AI clips yet — they appear here once rendering finishes.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {clips.map((clip) => {
        const candidate = candidateOf(clip);
        const score = candidate?.score ?? null;
        return (
          <div
            key={clip.id}
            className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"
          >
            <div className="relative">
              {clip.video_url ? (
                <video
                  src={clip.video_url}
                  className="aspect-[9/16] w-full bg-black object-contain"
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <div className="flex aspect-[9/16] w-full items-center justify-center bg-black/40 text-neutral-600">
                  {clip.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={clip.thumb_url}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-3xl">🎞️</span>
                  )}
                </div>
              )}
              <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
                {candidate ? rangeLabel(candidate.start_time, candidate.end_time) : formatTime(clip.duration)}
              </span>
              {score != null && (
                <span className="absolute right-2 top-2 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-black">
                  {Math.round(score)}/100
                </span>
              )}
            </div>

            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-white">
                  Krix Clip · {formatTime(clip.duration)}
                </h4>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-neutral-300">
                  9:16
                </span>
              </div>

              {candidate?.reason && (
                <p className="text-xs leading-relaxed text-neutral-400">
                  {candidate.reason}
                </p>
              )}

              {score != null && (
                <p className="text-[11px] text-neutral-500">
                  Krix Clip Quality Score:{' '}
                  <span className="font-semibold text-neutral-300">
                    {Math.round(score)}/100
                  </span>{' '}
                  · estimate, not a virality promise
                </p>
              )}

              <div className="flex gap-2 pt-1">
                {clip.video_url && (
                  <a
                    href={clip.video_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => toast('Download started', 'success')}
                    className="flex-1 rounded-lg bg-white text-center text-sm font-medium text-black transition-all hover:bg-neutral-200 active:scale-[0.97]"
                  >
                    ⭳ Download
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}