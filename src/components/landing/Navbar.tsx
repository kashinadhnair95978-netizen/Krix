'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { browserSupabase } from '@/lib/supabase';

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

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

        <div className="flex items-center gap-4 text-sm">
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
                className="group relative overflow-hidden rounded-full bg-white px-4 py-1.5 font-medium text-black transition-colors duration-200 hover:bg-neutral-200"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-neutral-400/40 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
                />
                <span className="relative">Sign up · It’s FREE</span>
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}