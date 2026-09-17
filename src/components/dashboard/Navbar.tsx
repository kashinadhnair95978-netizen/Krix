'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks';

const links = [
  { href: '/dashboard', label: 'Center' },
  { href: '/dashboard/videos', label: 'My clips' },
  { href: '/dashboard/calendar', label: 'Calendar' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/api', label: 'API' },
  { href: '/dashboard/settings', label: 'Settings' },
];

function initials(name?: string) {
  if (!name) return 'K';
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { user } = useAuth();

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link
            href="/dashboard"
            className="text-[17px] font-semibold tracking-tight text-white"
          >
            krix<span className="align-super text-[9px] text-neutral-500">™</span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {links.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-white/10 text-white font-medium'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('krix:cmd'))}
            className="hidden md:inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:border-white/25 hover:text-white"
            aria-label="Open command menu"
          >
            <span className="text-neutral-500">⌘</span>
            <span>K</span>
          </button>

          <Link
            href="/pricing"
            className="hidden sm:inline-flex items-center rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black transition-all hover:bg-neutral-200 active:scale-[0.97]"
          >
            Get free clips
          </Link>

          <Link
            href="/dashboard/settings"
            className="hidden md:flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-neutral-500 via-neutral-700 to-black text-xs font-semibold text-white ring-1 ring-white/25 shadow-[0_0_16px_-4px_rgba(255,255,255,0.4)] transition-transform hover:scale-105"
            title={user?.full_name || 'Account'}
          >
            {initials(user?.full_name)}
          </Link>

          <button
            className="md:hidden text-xl text-neutral-200"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="md:hidden border-t border-white/10 bg-black/90 px-4 py-3 space-y-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={`block rounded-lg px-3 py-2 text-sm ${
                isActive(link.href)
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/pricing"
            onClick={() => setMenuOpen(false)}
            className="mt-2 block rounded-full bg-white px-3 py-2 text-center text-sm font-medium text-black"
          >
            Get free clips
          </Link>
        </div>
      )}
    </header>
  );
}