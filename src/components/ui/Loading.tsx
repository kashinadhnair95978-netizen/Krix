export function Loading({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white" />
      <p className="text-sm text-neutral-400">{text}</p>
    </div>
  );
}