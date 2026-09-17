'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

interface Command {
  label: string;
  hint?: string;
  icon: string;
  href: string;
}

const commands: Command[] = [
  { label: 'Create new video', hint: 'Go', icon: '🎬', href: '/dashboard/upload' },
  { label: 'View your clips', hint: 'Go', icon: '🎥', href: '/dashboard/videos' },
  { label: 'My projects', hint: 'Go', icon: '🗂️', href: '/dashboard/projects' },
  { label: 'Open calendar', hint: 'Go', icon: '📅', href: '/dashboard/calendar' },
  { label: 'View analytics', hint: 'Go', icon: '📊', href: '/dashboard/analytics' },
  { label: 'Inspiration gallery', hint: 'Go', icon: '✨', href: '/dashboard/inspiration' },
  { label: 'API & MCP', hint: 'Go', icon: '🔌', href: '/dashboard/api' },
  { label: 'Team workspace', hint: 'Go', icon: '👥', href: '/dashboard/team' },
  { label: 'Go to Center', hint: 'Go', icon: '🏠', href: '/dashboard' },
  { label: 'Open settings', hint: 'Go', icon: '⚙️', href: '/dashboard/settings' },
  { label: 'See pricing', hint: 'Go', icon: '💳', href: '/pricing' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const toggle = () => {
      setOpen((o) => {
        if (o) return false;
        setQuery('');
        setActive(0);
        return true;
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape') setOpen(false);
    };

    const onCustom = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('krix:cmd', onCustom);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('krix:cmd', onCustom);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(
    () =>
      commands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase())
      ),
    [query]
  );

  const run = useCallback((href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  }, [router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && filtered[active]) {
        e.preventDefault();
        run(filtered[active].href);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, active, run]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 px-4 pt-24 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#101014] shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 px-4">
          <span className="text-neutral-500">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            className="w-full bg-transparent py-4 text-[15px] text-white placeholder:text-neutral-500 focus:outline-none"
            placeholder="Type a command or jump to a page…"
          />
          <kbd className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-neutral-500">
            esc
          </kbd>
        </div>
        <div className="max-h-80 overflow-auto border-t border-white/10 py-1.5">
          {filtered.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-neutral-500">
              No results for “{query}”
            </p>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.href}
              onClick={() => run(c.href)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm transition-colors',
                i === active ? 'bg-white/10 text-white' : 'text-neutral-300'
              )}
            >
              <span className="w-5 text-center">{c.icon}</span>
              <span className="flex-1">{c.label}</span>
              <kbd className="text-[10px] text-neutral-600">{c.hint}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}