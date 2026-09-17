'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Button } from '@/components/ui/Button';
import { Terminal, Bot } from '@/components/dashboard/icons';
import { Copy, Check } from '@/components/landing/icons';

const keyPlaceholder = 'kx_live_••••••••••••••••••••••••••••';
const codeSnippet = `// Install the Krix MCP server
npx -y krix-mcp@latest --api-key YOUR_KEY

// Then in your agent:
import { krix } from '@krix/mcp';

await krix.clip({
  videoUrl: 'https://youtube.com/watch?v=...',
  style: 'viral-shorts',
  aspectRatio: '9:16',
  captions: true,
});

await krix.schedule({
  clipId: 'clip_123',
  platform: ['tiktok', 'youtube', 'x'],
  times: ['Mon 09:00', 'Wed 17:30'],
});`;

function CodeBlock() {
  return (
    <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black p-5 text-[13px] leading-relaxed text-neutral-300">
      <code>{codeSnippet}</code>
    </pre>
  );
}

export default function ApiPage() {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText('kx_live_' + 'x'.repeat(32));
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 1500);
    } catch {}
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(codeSnippet);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 1500);
    } catch {}
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="API & MCP"
        subtitle="The video API and MCP server every AI agent can call — clip, caption, reframe, schedule, and publish."
        action={
          <Button inverse onClick={copyKey}>
            <Terminal className="mr-1.5 h-4 w-4" /> Generate API key
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Terminal className="h-5 w-5" /> API access
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Integrate Krix with your CMS, editor, or custom tools. Every agent can call the video API directly.
          </p>

          <div className="mt-5 rounded-xl border border-white/15 bg-black/50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Your API key</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <code className="truncate font-mono text-sm text-white">{keyPlaceholder}</code>
              <button
                onClick={copyKey}
                className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:border-white/40 hover:text-white"
              >
                {copiedKey ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <ul className="mt-5 space-y-2.5 text-sm">
            {[
              'POST /v1/clips — generate clips with scoring',
              'POST /v1/clips/{id}/edit — trim, reframe, captions, B-Roll',
              'POST /v1/clips/{id}/publish — schedule & auto-post',
              'GET /v1/usage — check remaining credits',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5 rounded-lg bg-white/[0.03] px-3 py-2 text-neutral-300">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/50" />
                <code className="text-[13px]">{line}</code>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Bot className="h-5 w-5" /> Video MCP — new
            </h2>
            <button
              onClick={copySnippet}
              className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:border-white/40 hover:text-white"
            >
              {copiedSnippet ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            Any AI agent workflow can use the MCP server — no custom code required.
          </p>
          <div className="mt-4">
            <CodeBlock />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] text-neutral-500">
            {['Clip & score', 'Captions', 'Schedule'].map((t) => (
              <div key={t} className="rounded-lg border border-white/10 bg-black/40 px-2 py-2">
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-neutral-400">
        <span className="font-medium text-white">💡 Pro tip:</span> paste your API key into any agent that supports
        MCP tool servers, then say “<span className="text-white">turn this long video into a month of posts</span>”.
        Full reference at <span className="text-white">docs.krix.app</span>.
      </div>
    </div>
  );
}