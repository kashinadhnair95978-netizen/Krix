import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-xl bg-white/10', className)}
      aria-hidden
    />
  );
}

export function SkeletonCard({
  lines = 2,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/10 bg-white/[0.03] p-5',
        className
      )}
    >
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="mt-3 h-3 w-full" />
      {lines > 2 && (
        <>
          <Skeleton className="mt-2 h-3 w-5/6" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </>
      )}
    </div>
  );
}