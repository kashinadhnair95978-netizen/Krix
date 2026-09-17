'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { LayoutGrid, Terminal, Bot } from '@/components/dashboard/icons';
import { Play, ArrowUpRight } from '@/components/landing/icons';

interface Card {
  kind: 'MCP workflow' | 'AI agent' | 'Automation' | 'Integration';
  title: string;
  description: string;
  metric: string;
  tag: string;
}

const templates: Card[] = [
  { kind: 'MCP workflow', title: 'Podcast → 30 clips + calendar', description: 'An agent watches your podcast RSS, clips golden moments, writes captions, and schedules posts to TikTok & X.', metric: '1h/day saved', tag: 'Podcast' },
  { kind: 'MCP workflow', title: 'YouTube drop → 10 Shorts', description: 'When a new long-form video publishes, MCP clips the highlights, reframes to 9:16, and posts Shorts automatically.', metric: '2 days saved', tag: 'YouTube' },
  { kind: 'AI agent', title: 'Weekly newsletter from YouTube', description: 'Agent transcribes your latest video, drafts the newsletter, generates a thumbnail, and schedules the send.', metric: '4 posts/week', tag: 'Growth' },
  { kind: 'Automation', title: 'Livestream highlights auto-cut', description: 'Slice VODs into energy clips, add B-Roll, and create teasers to drive traffic back to the next stream.', metric: '10x reach', tag: 'Livestreams' },
  { kind: 'Integration', title: 'CMS + API video pipeline', description: 'Hook Krix into your CMS: submissions get clipped, captioned, and published with zero manual steps.', metric: 'Zero clicks', tag: 'Enterprise' },
  { kind: 'MCP workflow', title: 'Content repurposing bot', description: 'Ask your assistant to “turn this into a month of posts” — it runs the full clip → copy → schedule flow end-to-end.', metric: 'A month of posts', tag: 'Assistant' },
  { kind: 'Automation', title: 'A/B thumbnail variants', description: 'Auto-generate 3 thumbnail options per clip, then publish the winning variant to YouTube based on CTR.', metric: '+22% CTR', tag: 'Thumbnails' },
  { kind: 'MCP workflow', title: 'Sales team demo clips', description: 'Turn every sales call recording into shareable highlight reels for social proof and enablement.', metric: 'Sales 2x', tag: 'Sales' },
];

const categories = ['All', 'MCP workflow', 'AI agent', 'Automation', 'Integration'];

export default function InspirationPage() {
  const [active, setActive] = useState('All');

  const filtered = active === 'All' ? templates : templates.filter((t) => t.kind === active);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Inspiration gallery"
        subtitle="See what teams build with the Krix API and MCP — workflows, agents, and automations you can copy."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-neutral-300">
            <Bot className="h-3.5 w-3.5" /> 40+ community builds
          </span>
        }
      />

      <div className="mb-8 flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setActive(c)}
            className={`rounded-full px-4 py-1.5 text-sm transition-all ${
              active === c
                ? 'bg-white text-black font-medium'
                : 'border border-white/10 text-neutral-400 hover:border-white/30 hover:text-white'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-12 text-center text-neutral-400">
          No builds in this category yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((card) => (
            <div
              key={card.title}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-all hover:border-white/25 hover:bg-white/[0.05]"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white transition-all group-hover:bg-white group-hover:text-black">
                  {card.kind.includes('MCP') || card.kind === 'AI agent' ? (
                    <Bot className="h-4 w-4" />
                  ) : (
                    <Terminal className="h-4 w-4" />
                  )}
                </div>
                <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                  <Play className="h-2.5 w-2.5" /> {card.tag}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{card.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{card.description}</p>
              <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
                <span className="text-xs font-medium text-green-300">{card.metric}</span>
                <span className="inline-flex items-center gap-1 text-xs text-neutral-500 transition-colors group-hover:text-white">
                  Copy workflow <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 text-center">
        <LayoutGrid className="mx-auto h-8 w-8 text-white/60" />
        <h3 className="mt-3 text-xl font-semibold text-white">Build something worth copying</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-neutral-400">
          Connect Krix to your agent with the MCP server, or call the API directly. Docs are ready when you are.
        </p>
        <a href="/dashboard/api" className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200">
          Get an API key <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}