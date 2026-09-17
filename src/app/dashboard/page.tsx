'use client';

import { useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth, useSubscription, useAnalytics, useInterval } from '@/lib/hooks';
import { apiClient } from '@/lib/api-client';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/dashboard/StatusPill';
import { Play, Wand, Scissors, Refresh, ArrowUpRight } from '@/components/landing/icons';

interface VideoItem {
  id: string;
  title: string;
  status: 'processing' | 'completed' | 'failed';
  created_at: string;
}

const linkSources = ['YouTube', 'Google Drive', 'Vimeo', 'Zoom', 'Rumble', 'Twitch', 'Loom', 'Riverside'];

const createTiles = [
  {
    title: 'ClipAnything',
    tag: 'Popular',
    description: 'Turn one long video into 10 viral shorts.',
    icon: <Scissors className="h-5 w-5" />,
  },
  {
    title: 'AI Producer',
    tag: 'New',
    description: 'Polish raw footage into a ready-to-post fine cut.',
    icon: <Wand className="h-5 w-5" />,
  },
  {
    title: 'AI B-Roll',
    description: 'Add relevant B-Roll in 1 click, under 1 minute.',
    icon: <Play className="h-5 w-5" />,
  },
  {
    title: 'AI Reframe',
    description: 'Resize any video for every platform in 1 click.',
    icon: <Refresh className="h-5 w-5" />,
  },
];

function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      <div className="animate-pulse">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-9 w-72" />
        <Skeleton className="mt-3 h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-44 w-full rounded-3xl" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
      <SkeletonCard lines={3} />
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const { user, loading: userLoading } = useAuth();
  const { subscription, loading: subLoading } = useSubscription();
  const { analytics, loading: analyticsLoading, refetch: refetchAnalytics } = useAnalytics();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [videosLoading, setVideosLoading] = useState(true);
  const [videosError, setVideosError] = useState('');
  const [link, setLink] = useState('');

  const fetchVideos = useCallback(async () => {
    try {
      const response = await apiClient.getVideos();
      setVideos(response.data);
      setVideosError('');
    } catch (err: any) {
      setVideosError(err.response?.data?.message || 'Could not load your videos');
    } finally {
      setVideosLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  const processingCount = videos.filter((v) => v.status === 'processing').length;
  useInterval(fetchVideos, processingCount > 0 ? 8000 : null);
  useInterval(refetchAnalytics, processingCount > 0 ? 15000 : null);

  const loading = userLoading || subLoading || analyticsLoading || videosLoading;
  if (loading) return <DashboardSkeleton />;

  const ready = videos.filter((v) => v.status === 'completed').length;
  const onPro = subscription?.status === 'active';
  const firstName = (user?.full_name || '').split(/\s+/)[0] || 'Creator';
  const postsThisWeek = analytics?.postsThisWeek ?? 0;

  const handlePasteLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!link.trim()) return;
    router.push(`/dashboard/upload?url=${encodeURIComponent(link.trim())}`);
  };

  return (
    <div className="space-y-8 animate-fade-up">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-neutral-500">Center</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Clip anything, {firstName}.
          </h1>
          <p className="mt-2 max-w-xl text-neutral-400">
            Turn long videos into viral shorts — and publish everywhere. One link in, a month of content out.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {onPro ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-400/30 bg-green-400/10 px-3 py-1.5 text-xs font-medium tabular-nums text-green-300">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              {subscription.plan} plan
            </span>
          ) : (
            <Link href="/pricing">
              <Button inverse>Get free clips →</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Create panel */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.09] to-white/[0.02] p-6 sm:p-10">
        <div aria-hidden className="pointer-events-none absolute -top-24 right-0 h-64 w-96 rounded-full bg-white/10 blur-3xl" />

        <h2 className="text-balance text-2xl font-semibold tracking-tight text-white md:text-3xl">
          1 long video, 10 viral clips.
        </h2>
        <p className="mt-2 max-w-2xl text-neutral-400">
          Paste a video link or upload a file. Krix clips the highlights, adds captions, and
          prepares every format for you.
        </p>

        <form onSubmit={handlePasteLink} className="relative z-10 mt-8">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                  <path d="m10 13.5 4-4.5" />
                  <path d="M11 4.5 14 1.7a3.6 3.6 0 0 1 5.1 5.1L16 10" />
                  <path d="M13 19.5 10 22.3a3.6 3.6 0 0 1-5.1-5.1L8 14" />
                </svg>
              </span>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Paste a video link…"
                className="w-full rounded-2xl border border-white/15 bg-black/50 py-3.5 pl-11 pr-4 text-sm text-white placeholder:text-neutral-500 backdrop-blur focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>
            <Button type="submit" inverse size="lg" className="shrink-0">
              Get free clips
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-neutral-500">
            <span className="uppercase tracking-wider">Sources:</span>
            {linkSources.map((source) => (
              <span key={source} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-neutral-400">
                {source}
              </span>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3 text-sm text-neutral-500">
            <span className="h-px flex-1 bg-white/10" />
            <span>or</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <Link href="/dashboard/upload" className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/30 hover:bg-white/5">
            Upload files
          </Link>
        </form>
      </section>

      {/* Error */}
      {videosError && (
        <div className="rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-300">
          {videosError}
        </div>
      )}

      {/* Quick create tiles */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Create with AI</h2>
            <p className="text-sm text-neutral-500">Pick a workflow to start creating.</p>
          </div>
          <Link href="/dashboard/upload" className="text-sm text-neutral-400 transition-colors hover:text-white">
            New upload →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {createTiles.map((tile) => (
            <Link
              key={tile.title}
              href="/dashboard/upload"
              className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-all hover:border-white/25 hover:bg-white/[0.06]"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white transition-all duration-300 group-hover:bg-white group-hover:text-black">
                  {tile.icon}
                </div>
                {tile.tag && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    {tile.tag}
                  </span>
                )}
              </div>
              <h3 className="mt-4 font-semibold text-white">{tile.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">{tile.description}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          { label: 'Videos', value: videos.length },
          { label: 'Ready to post', value: ready },
          { label: 'Processing', value: processingCount },
          { label: 'Posts this week', value: postsThisWeek },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm transition-all hover:border-white/25 hover:bg-white/[0.06]"
          >
            <p className="text-3xl font-semibold tracking-tight text-white tabular-nums">{stat.value}</p>
            <p className="mt-1 text-sm text-neutral-500">{stat.label}</p>
          </div>
        ))}
      </section>

      {/* Recent videos */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Recent clips</h2>
            <p className="text-sm text-neutral-500">Your latest uploads and repurposing status.</p>
          </div>
          <Link href="/dashboard/videos" className="inline-flex items-center gap-1 text-sm text-neutral-400 transition-colors hover:text-white">
            View all <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {videos.length === 0 ? (
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] p-8 text-center sm:p-12">
            <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
            <p className="text-5xl">🎬</p>
            <h3 className="mt-4 text-2xl font-semibold text-white">Upload your first video</h3>
            <p className="mx-auto mt-2 max-w-md text-neutral-400">
              Drop in a recording and Krix will turn it into ready-to-post shorts and posts in minutes.
            </p>
            <Link href="/dashboard/upload" className="mt-6 inline-block">
              <Button inverse size="lg">Get started</Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {videos.slice(0, 4).map((video) => (
              <Link
                key={video.id}
                href={`/dashboard/content/${video.id}`}
                className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-all hover:border-white/25 hover:bg-white/[0.07]"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-neutral-700 to-neutral-900 text-xl ring-1 ring-white/10">
                  🎥
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{video.title}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {new Date(video.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <StatusPill status={video.status} />
                <span className="text-neutral-600 transition-colors group-hover:text-white">→</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}