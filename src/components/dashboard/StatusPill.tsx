import { cn } from '@/lib/utils';

const styles: Record<string, string> = {
  completed: 'bg-green-400/10 text-green-300 ring-green-400/30',
  processing: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  failed: 'bg-red-400/10 text-red-300 ring-red-400/30',
};

const labels: Record<string, string> = {
  completed: 'Ready',
  processing: 'Processing',
  failed: 'Failed',
};

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        styles[status] || 'bg-white/10 text-neutral-300 ring-white/20',
        className
      )}
    >
      {status === 'processing' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
      )}
      {status === 'completed' && (
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
      )}
      {status === 'failed' && (
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
      )}
      {labels[status] || status}
    </span>
  );
}