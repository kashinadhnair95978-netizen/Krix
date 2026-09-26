'use client';

import { cn } from '@/lib/utils';

const STAGES = [
  { key: 'queued', label: 'Upload' },
  { key: 'transcribing', label: 'Transcription' },
  { key: 'analyzing', label: 'Video analysis' },
  { key: 'finding_clips', label: 'Finding best clips' },
  { key: 'rendering', label: 'Rendering clips' },
  { key: 'completed', label: 'Complete' },
];

const ORDER = STAGES.map((s) => s.key);

function stageIndex(stage?: string): number {
  if (!stage) return -1;
  const idx = ORDER.indexOf(stage);
  if (idx !== -1) return idx;
  if (stage === 'uploaded') return 0;
  if (stage === 'failed') return ORDER.length;
  return -1;
}

export function PipelineProgress({
  stage,
  error,
}: {
  stage?: string;
  error?: string;
}) {
  const current = stageIndex(stage);

  return (
    <div className="space-y-2">
      {STAGES.map((item, index) => {
        const done = current >= index;
        const active = current === index && current < ORDER.length - 1;
        const failed = stage === 'failed';
        return (
          <div key={item.key} className="flex items-center gap-3">
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ring-1 ring-inset',
                failed && !done
                  ? 'bg-red-400/10 text-red-300 ring-red-400/30'
                  : done
                  ? 'bg-green-400/10 text-green-300 ring-green-400/30'
                  : 'bg-white/5 text-neutral-500 ring-white/10'
              )}
            >
              {failed && !done ? '✕' : done ? '✓' : index + 1}
            </span>
            <span
              className={cn(
                'text-sm',
                done
                  ? 'text-neutral-200'
                  : active
                  ? 'font-medium text-white'
                  : 'text-neutral-500'
              )}
            >
              {item.label}
            </span>
            {active && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
            )}
            {done && index < ORDER.length - 1 && (
              <span className="h-px flex-1 bg-white/10" />
            )}
          </div>
        );
      })}
      {error && (
        <p className="pt-1 text-xs text-red-300">{error}</p>
      )}
    </div>
  );
}