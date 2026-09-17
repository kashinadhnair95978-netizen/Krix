'use client';

import { useCallback, useMemo, useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusPill } from './StatusPill';
import { useInterval } from '@/lib/hooks';

interface VideoItem {
  id: string;
  title: string;
  status: 'processing' | 'completed' | 'failed';
  created_at: string;
}

const filters = ['all', 'completed', 'processing', 'failed'] as const;

export function VideoLibrary() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<(typeof filters)[number]>('all');

  const fetchVideos = useCallback(async () => {
    try {
      const response = await apiClient.getVideos();
      setVideos(response.data);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  const processingCount = videos.filter((v) => v.status === 'processing').length;
  useInterval(fetchVideos, processingCount > 0 ? 8000 : null);

  const counts = useMemo(
    () => ({
      all: videos.length,
      completed: videos.filter((v) => v.status === 'completed').length,
      processing: processingCount,
      failed: videos.filter((v) => v.status === 'failed').length,
    }),
    [videos, processingCount]
  );

  const filtered = useMemo(
    () =>
      videos.filter((v) => {
        const matchesSearch = v.title
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesFilter = filter === 'all' || v.status === filter;
        return matchesSearch && matchesFilter;
      }),
    [videos, search, filter]
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
    );
  }

  if (error) return <div className="text-sm text-red-300">{error}</div>;

  if (videos.length === 0) {
    return (
      <div className="py-12 text-center text-neutral-500">
        <div className="mb-2 text-4xl">🎬</div>
        <p>No videos yet. Upload your first one!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xs flex-1 sm:max-w-sm">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500">
            ⌕
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search videos…"
            className="w-full rounded-xl border border-white/10 bg-white/[0.06] py-2 pl-9 pr-4 text-sm text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-all ${
                filter === f
                  ? 'bg-white text-black'
                  : 'text-neutral-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {f === 'all' ? 'All' : f}
              <span className={filter === f ? 'ml-1.5 opacity-60 tabular-nums' : 'ml-1.5 text-neutral-600 tabular-nums'}>
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-neutral-500">
          No videos match your search.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((video) => (
            <a
              key={video.id}
              href={`/dashboard/content/${video.id}`}
              className="group block rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-all hover:border-white/25 hover:bg-white/[0.07]"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-neutral-700 to-neutral-900 text-lg ring-1 ring-white/10">
                    🎥
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-medium text-white">
                      {video.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {new Date(video.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
                <StatusPill status={video.status} />
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}