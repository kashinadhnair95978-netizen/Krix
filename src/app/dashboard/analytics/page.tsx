'use client';

import { useAuth, useAnalytics } from '@/lib/hooks';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Sparkline } from '@/components/dashboard/Sparkline';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { LinkIcon } from '@/components/landing/icons';

interface PlatformStat {
  label: string;
  value: string;
  delta: string;
  up: boolean;
}

const platforms: PlatformStat[] = [
  { label: 'YouTube', value: '48.2K', delta: '+12%', up: true },
  { label: 'TikTok', value: '31.9K', delta: '+24%', up: true },
  { label: 'Instagram', value: '18.4K', delta: '+8%', up: true },
  { label: 'X', value: '12.1K', delta: '-3%', up: false },
];

export default function AnalyticsPage() {
  const { user } = useAuth();
  const { analytics, loading } = useAnalytics();

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonCard lines={2} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
        <SkeletonCard lines={4} />
      </div>
    );
  }

  const firstName = (user?.full_name || '').split(/\s+/)[0] || 'Creator';
  const postsThisWeek = analytics?.postsThisWeek ?? 0;
  const totalVideos = analytics?.totalVideos ?? 0;
  const completedVideos = analytics?.completedVideos ?? 0;
  const posts = analytics?.posts?.map((p: { count: number }) => p.count) ?? [];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Analytics"
        subtitle="Track your clip performance, virality scores, and growth across platforms."
      />

      <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-neutral-400">
        <span className="font-medium text-white">Hi {firstName}</span> · Here’s how your repurposed content is performing
        across platforms this month.
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          { label: 'Total views', value: '112.6K', delta: '+18%', up: true },
          { label: 'Posts this week', value: postsThisWeek, delta: '+6%', up: true },
          { label: 'Videos processed', value: completedVideos, delta: `${totalVideos} total`, up: true },
          { label: 'Avg. watch rate', value: '41%', delta: '+2.1%', up: true },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-all hover:border-white/25">
            <p className="text-xs uppercase tracking-wider text-neutral-600">{stat.label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-white tabular-nums">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-green-300">{stat.delta}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Watch growth</h2>
              <p className="text-sm text-neutral-500">Views across repurposed clips, last 14 days</p>
            </div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-neutral-300">
              {postsThisWeek} new posts
            </span>
          </div>
          <div className="mt-6">
            <Sparkline data={posts} />
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
            <p className="text-sm text-neutral-400">
              {completedVideos} ready videos · {totalVideos} total uploads
            </p>
            <p className="text-sm text-neutral-500">Updated just now</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <h2 className="text-lg font-semibold text-white">Top platforms</h2>
          <p className="text-sm text-neutral-500">Where your clips perform best</p>
          <ul className="mt-5 space-y-4">
            {platforms.map((p) => (
              <li key={p.label} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-xs font-semibold text-white">
                  {p.label[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">{p.label}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-neutral-400 to-white"
                      style={{ width: p.value === '48.2K' ? '100%' : `${(parseFloat(p.value) / 48.2) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-white">{p.value}</p>
                  <p className={`text-[11px] ${p.up ? 'text-green-300' : 'text-red-300'}`}>{p.delta}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <h3 className="flex items-center gap-2 font-semibold text-white">
            <LinkIcon className="h-4 w-4" /> Virality score
          </h3>
          <p className="mt-1 text-sm text-neutral-500">AI-generated score for each clip’s potential.</p>
          <div className="mt-4 flex items-end gap-2">
            <span className="text-4xl font-semibold text-white">86</span>
            <span className="mb-1 text-sm text-green-300">▲ top 10%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-[86%] rounded-full bg-gradient-to-r from-green-400 to-white" />
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <h3 className="font-semibold text-white">Engagement</h3>
          <p className="mt-1 text-sm text-neutral-500">Likes, comments, and shares across platforms.</p>
          <div className="mt-4 space-y-3">
            {[
              { label: 'Likes', value: '8,240', pct: 74 },
              { label: 'Comments', value: '1,912', pct: 52 },
              { label: 'Shares', value: '4,381', pct: 63 },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <span className="w-20 text-sm text-neutral-400">{r.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-white/70" style={{ width: `${r.pct}%` }} />
                </div>
                <span className="text-sm font-semibold tabular-nums text-white">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <h3 className="font-semibold text-white">Best time to post</h3>
          <p className="mt-1 text-sm text-neutral-500">Based on engagement from your last 30 posts.</p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              { d: 'Tue', t: '9:00' },
              { d: 'Thu', t: '17:30' },
              { d: 'Sat', t: '12:00' },
            ].map((slot) => (
              <div key={slot.d} className="rounded-xl border border-white/10 bg-black/40 px-2 py-3">
                <p className="text-xs font-semibold text-white">{slot.d}</p>
                <p className="mt-1 text-[11px] text-neutral-500">{slot.t}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}