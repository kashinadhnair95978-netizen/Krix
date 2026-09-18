'use client';

import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ComingSoonProps {
  children: ReactNode;
  className?: string;
  title?: string;
  message?: string;
  as?: 'button' | 'span';
}

export function ComingSoon({
  children,
  className,
  title = 'Coming soon',
  message = 'This feature is still in the works. We’ll let you know the moment it ships.',
  as = 'button',
}: ComingSoonProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [open]);

  const Tag = as === 'button' ? 'button' : 'span';

  return (
    <>
      <Tag
        type={as === 'button' ? 'button' : undefined}
        onClick={() => setOpen(true)}
        className={cn('cursor-pointer', className)}
        aria-haspopup="dialog"
      >
        {children}
      </Tag>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="relative z-10 w-full max-w-md rounded-3xl border border-white/15 bg-[#0d0d0f] p-8 text-center shadow-2xl"
            role="dialog"
            aria-modal="true"
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 text-2xl leading-none text-neutral-500 transition-colors hover:text-white"
              aria-label="Close"
            >
              ×
            </button>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.05] text-2xl">
              🚧
            </div>
            <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">
              {title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">
              {message}
            </p>
            <button
              onClick={() => setOpen(false)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}