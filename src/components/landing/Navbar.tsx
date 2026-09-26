'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { browserSupabase } from '@/lib/supabase';

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    browserSupabase.auth
      .getUser()
      .then(({ data }) => setSignedIn(Boolean(data.user)))
      .catch(() => setSignedIn(false));
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 backdrop-blur-xl transition-all duration-300',
        scrolled
          ? 'border-b border-white/10 bg-black/90 shadow-[0_1px_3px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.03)]'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <nav className="mx-auto flex h-12 max-w-5xl items-center justify-between px-6">
        <Link href="/" className="text-[17px] font-semibold tracking-tight text-white">
          krix<span className="align-super text-[9px] text-neutral-500">™</span>
        </Link>

        <div className="hidden items-center gap-8 text-sm text-neutral-400 md:flex">
          <Link href="#capabilities" className="transition-colors duration-200 hover:text-white">
            Features
          </Link>
          <Link href="#solutions" className="transition-colors duration-200 hover:text-white">
            Solutions
          </Link>
          <Link href="#workflow" className="transition-colors duration-200 hover:text-white">
            Workflow
          </Link>
          <Link href="/pricing" className="transition-colors duration-200 hover:text-white">
            Pricing
          </Link>
          <Link href="#testimonials" className="transition-colors duration-200 hover:text-white">
            Creators
          </Link>
          <Link href="#faq" className="transition-colors duration-200 hover:text-white">
            FAQ
          </Link>
        </div>

        <div className="flex items-center gap-2 text-sm sm:gap-4">
          {signedIn ? (
            <Link
              href="/dashboard"
              className="rounded-full bg-white px-4 py-1.5 font-medium text-black transition-colors duration-200 hover:bg-neutral-200"
            >
              My dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="hidden text-neutral-400 transition-colors duration-200 hover:text-white sm:inline"
              >
                Sign in
              </Link>
              <Link
                href="/auth/signup"
                className="hidden rounded-full bg-white px-4 py-1.5 font-medium text-black transition-colors duration-200 hover:bg-neutral-200 sm:inline"
              >
                Sign up · It’s FREE
              </Link>
            </>
          )}

          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-2xl text-neutral-100 transition-colors hover:bg-white/10 md:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="border-t border-white/10 bg-black/95 px-6 pb-6 pt-3 backdrop-blur-xl md:hidden">
          <div className="flex flex-col space-y-1">
            {[
              { href: '#capabilities', label: 'Features' },
              { href: '#solutions', label: 'Solutions' },
              { href: '#workflow', label: 'Workflow' },
              { href: '/pricing', label: 'Pricing' },
              { href: '#testimonials', label: 'Creators' },
              { href: '#faq', label: 'FAQ' },
            ].map((l) => (
              <Link
                key={l.label}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm text-neutral-300 transition-colors hover:bg-white/5 hover:text-white"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 border-t border-white/10 pt-3">
              {signedIn ? (
                <Link
                  href="/dashboard"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-full bg-white px-4 py-2.5 text-center text-sm font-medium text-black transition-colors hover:bg-neutral-200"
                >
                  My dashboard
                </Link>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href="/auth/login"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-full border border-white/15 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-white/5"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/auth/signup"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-full bg-white px-4 py-2.5 text-center text-sm font-medium text-black transition-colors hover:bg-neutral-200"
                  >
                    Sign up · FREE
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}