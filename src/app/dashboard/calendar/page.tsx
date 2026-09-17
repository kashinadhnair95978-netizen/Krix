'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Button } from '@/components/ui/Button';
import { CalendarIcon, Plus } from '@/components/dashboard/icons';

interface ScheduledPost {
  id: string;
  time: string;
  platform: string;
  label: string;
  tone?: string;
}

interface DayPosts {
  [day: number]: ScheduledPost[];
}

const platformColor: Record<string, string> = {
  YouTube: 'bg-red-500/20 text-red-300 ring-red-500/40',
  TikTok: 'bg-slate-200/20 text-slate-100 ring-white/30',
  Instagram: 'bg-pink-500/20 text-pink-300 ring-pink-500/40',
  X: 'bg-white/10 text-white ring-white/30',
  LinkedIn: 'bg-blue-500/20 text-blue-300 ring-blue-500/40',
  Facebook: 'bg-indigo-500/20 text-indigo-300 ring-indigo-500/40',
};

const platforms = Object.keys(platformColor);

const seedPosts: DayPosts = {
  3: [
    { id: 'p1', time: '09:00', platform: 'YouTube', label: 'Hook lede — viral moment', tone: 'Shorts' },
    { id: 'p2', time: '17:30', platform: 'X', label: 'Takeaway thread (1/4)', tone: 'Post' },
  ],
  5: [{ id: 'p3', time: '12:00', platform: 'LinkedIn', label: 'Insight story post', tone: 'Post' }],
  8: [{ id: 'p4', time: '10:00', platform: 'TikTok', label: 'Golden moment clip', tone: 'Shorts' }],
  12: [{ id: 'p5', time: '16:00', platform: 'Instagram', label: 'Carousel from transcripts', tone: 'Reels' }],
  15: [{ id: 'p6', time: '09:30', platform: 'Facebook', label: 'Full-talk teaser', tone: 'Post' }],
};

function buildGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { startDay, daysInMonth };
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [posts, setPosts] = useState<DayPosts>(seedPosts);
  const [draft, setDraft] = useState({ time: '09:00', platform: 'YouTube', label: '' });
  const [editingDay, setEditingDay] = useState<number | null>(null);

  const { startDay, daysInMonth } = useMemo(() => buildGrid(year, month), [year, month]);

  const totalPosts = useMemo(
    () => Object.values(posts).reduce((sum, list) => sum + list.length, 0),
    [posts]
  );

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.label.trim() || editingDay === null) return;
    const post: ScheduledPost = { id: `p-${Date.now()}`, ...draft };
    setPosts((prev) => ({ ...prev, [editingDay]: [...(prev[editingDay] || []), post] }));
    setDraft({ time: '09:00', platform: 'YouTube', label: '' });
    setEditingDay(null);
  };

  const cells: (number | null)[] = [
    ...Array.from({ length: startDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Calendar"
        subtitle={`Publish and schedule to YouTube, TikTok, Instagram, X, Facebook, and LinkedIn. ${totalPosts} posts scheduled this month.`}
        action={
          <div className="flex items-center gap-3 text-sm text-neutral-400">
            <button onClick={prevMonth} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-neutral-300 transition-colors hover:border-white/40 hover:text-white">←</button>
            <span className="min-w-36 text-center font-medium text-white">
              {monthNames[month]} {year}
            </span>
            <button onClick={nextMonth} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-neutral-300 transition-colors hover:border-white/40 hover:text-white">→</button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <span key={d} className="py-1">{d}</span>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
              {cells.map((day, i) => {
                if (day === null) {
                  return <div key={`empty-${i}`} className="min-h-24 rounded-xl bg-transparent" />;
                }
                const dayPosts = posts[day] || [];
                const isToday = day === now.getDate() && month === now.getMonth() && year === now.getFullYear();
                return (
                  <button
                    key={day}
                    onClick={() => setEditingDay(editingDay === day ? null : day)}
                    className={`group relative min-h-24 rounded-xl border p-1.5 text-left transition-all ${
                      isToday
                        ? 'border-white/50 bg-white/[0.08]'
                        : 'border-white/10 bg-black/30 hover:border-white/30 hover:bg-white/[0.05]'
                    } ${editingDay === day ? 'ring-2 ring-white/40' : ''}`}
                  >
                    <span className={`text-xs font-medium ${isToday ? 'text-white' : 'text-neutral-500'}`}>{day}</span>
                    <div className="mt-1 space-y-1">
                      {dayPosts.slice(0, 3).map((post) => (
                        <div key={post.id} className={`truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${platformColor[post.platform]}`}>
                          {post.time} {post.label}
                        </div>
                      ))}
                      {dayPosts.length > 3 && (
                        <div className="px-1 text-[10px] text-neutral-600">+{dayPosts.length - 3} more</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h3 className="flex items-center gap-2 font-semibold text-white">
              <CalendarIcon className="h-4 w-4" />
              {editingDay ? `Schedule on day ${editingDay}` : 'Schedule a post'}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              {editingDay
                ? 'Pick a platform, time, and description for this day.'
                : 'Tap a day on the calendar to pick a date.'}
            </p>

            {editingDay !== null && (
              <form onSubmit={handleAdd} className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={draft.time}
                    onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
                    className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                  >
                    {['00:00', '08:00', '09:00', '10:00', '12:00', '14:00', '16:00', '17:30', '18:00', '20:00'].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <select
                    value={draft.platform}
                    onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value }))}
                    className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                  >
                    {platforms.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <input
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="Description — AI writes captions & hashtags"
                  className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                />
                <Button type="submit" inverse className="w-full">
                  <Plus className="mr-1 h-4 w-4" /> Schedule post
                </Button>
              </form>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h3 className="font-semibold text-white">Upcoming posts</h3>
            <ul className="mt-3 space-y-2.5">
              {Object.entries(posts)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([day, list]: [string, ScheduledPost[]]) =>
                  list.map((post) => (
                    <li key={post.id} className="flex items-center gap-3 rounded-xl bg-black/40 px-3 py-2 text-sm">
                      <span className="w-9 shrink-0 font-mono text-xs text-neutral-500">Day {day}</span>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${platformColor[post.platform]}`}>
                        {post.platform}
                      </span>
                      <span className="truncate text-neutral-300">{post.label}</span>
                    </li>
                  ))
                )}
            </ul>
          </div>

          <Link href="/dashboard/upload" className="block">
            <Button variant="outline" inverse className="w-full">
              Upload a video to schedule →
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}