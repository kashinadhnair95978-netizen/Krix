import { cn } from '@/lib/utils';

const styles: Record<string, string> = {
  completed: 'bg-green-400/10 text-green-300 ring-green-400/30',
  processing: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  failed: 'bg-red-400/10 text-red-300 ring-red-400/30',
  queued: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  transcribing: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  analyzing: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  finding_clips: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  rendering: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
};

const labels: Record<string, string> = {
  completed: 'Ready',
  processing: 'Processing',
  failed: 'Failed',
  queued: 'Queued',
  transcribing: 'Transcribing',
  analyzing: 'Analyzing',
  finding_clips: 'Finding clips',
  rendering: 'Rendering',
};

/**
 * Show the live processing stage when a video is processing, otherwise the
 * coarse status. Accepts either a Video status or a processing_stage value.
 */
export function StatusPill({
  status,
  stage,
  className,
}: {
  status: string;
  stage?: string | null;
  className?: string;
}) {
  const labelStatus = status === 'processing' && stage ? stage : status;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        styles[labelStatus] || 'bg-white/10 text-neutral-300 ring-white/20',
        className
      )}
    >
      {labelStatus === 'processing' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
      )}
      {labelStatus === 'completed' && (
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
      )}
      {labelStatus === 'failed' && (
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
      )}
      {labelStatus !== 'completed' &&
        labelStatus !== 'failed' &&
        labelStatus !== 'processing' && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
        )}
      {labels[labelStatus] || status}
    </span>
  );
}