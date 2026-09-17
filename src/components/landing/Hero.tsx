import Link from 'next/link';
import { ArrowRight, Play, Captions, LinkIcon, Refresh } from './icons';
import { BlackHoleBackground } from './BlackHoleBackground';

const creators = [
  { initials: 'GH', name: 'Grant C.', followers: '4.9M' },
  { initials: 'JL', name: 'Jason L.', followers: '180K' },
  { initials: 'JH', name: 'Jenny H.', followers: '4.2M' },
  { initials: 'TS', name: 'TwoSet', followers: '4.3M' },
  { initials: 'MB', name: 'Mia B.', followers: '1.2M' },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-black pt-28 pb-24 md:pt-36 md:pb-32">
      <BlackHoleBackground />

      <div className="relative mx-auto max-w-5xl px-6 text-center">
        {/* social proof strip */}
        <div className="mb-9 flex animate-fade-up items-center justify-center">
          <div className="flex -space-x-3">
            {creators.map((c) => (
              <span
                key={c.initials}
                title={c.name}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-neutral-600 to-neutral-800 text-[10px] font-semibold text-white ring-2 ring-black"
              >
                {c.initials}
              </span>
            ))}
          </div>
          <p className="ml-3 text-left text-[13px] leading-tight text-neutral-400">
            Used by <span className="font-semibold text-white">10,000+</span> creators
            <br className="sm:hidden" /> and businesses
          </p>
        </div>

        {/* eyebrow */}
        <p className="mb-6 animate-fade-up">
          <span className="inline-flex items-center gap-2.5 rounded-full border border-neutral-800 bg-white/[0.03] px-4 py-1.5 text-xs font-medium text-neutral-400 transition-colors duration-500 ease-out hover:border-neutral-500 hover:text-white">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            New · Clip any genre, not just podcasts
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </p>

        {/* headline */}
        <h1 className="animate-fade-up text-balance text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl lg:text-[5.5rem] lg:leading-[1.04]">
          <span className="text-white">Turn one video into</span>
          <br className="hidden md:block" />{' '}
          <span className="bg-gradient-to-b from-white via-white to-neutral-500 bg-clip-text text-transparent">
            one hundred posts.
          </span>
        </h1>

        {/* subhead */}
        <p className="animate-fade-up mx-auto mt-7 max-w-2xl text-lg text-neutral-400 md:text-[1.35rem] md:leading-relaxed">
          Krix is the AI workspace that turns a single upload into shorts,
          tweets, blogs, emails and more. One click in, your whole pipeline out.
        </p>

        {/* CTAs */}
        <div className="animate-fade-up mt-10 flex flex-col items-center justify-center gap-6 sm:flex-row sm:gap-8">
          <Link
            href="/auth/signup"
            className="group relative overflow-hidden rounded-full bg-white px-8 py-3.5 text-sm font-medium text-black transition-all duration-300 hover:scale-[1.03]"
          >
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-neutral-400/30 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
            />
            <span className="relative">Start free — It’s FREE</span>
          </Link>

          <Link
            href="#capabilities"
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-white transition-colors duration-200 hover:text-neutral-400"
          >
            See it in action
            <ArrowRight className="h-4 w-4 transition-transform duration-300 ease-out group-hover:translate-x-0.5" />
          </Link>
        </div>

        {/* product preview */}
        <div className="animate-fade-up mt-16 md:mt-20">
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-neutral-900 to-black shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]">
            <div className="flex h-[360px] items-center justify-center bg-[radial-gradient(70%_60%_at_50%_40%,rgba(255,255,255,0.08)_0%,transparent_70%)] md:h-[420px]">
              <span className="absolute flex h-14 w-14 items-center justify-center rounded-full bg-white text-black shadow-[0_0_60px_rgba(255,255,255,0.35)] transition-transform duration-300 ease-out group-hover:scale-105 md:h-16 md:w-16">
                <Play className="ml-1 h-4 w-4 md:h-5 md:w-5" />
              </span>
            </div>

            {/* caption bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/60 px-5 py-4 backdrop-blur">
              <span className="inline-flex items-center gap-2 text-sm text-neutral-300">
                <Captions className="h-4 w-4 text-white/70" />
                Auto-captions · hook detection · platform resize
              </span>
              <div className="flex items-center gap-2">
                {['YT Shorts', 'LinkedIn', 'X', 'Blog', 'Email'].map((f) => (
                  <span
                    key={f}
                    className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-neutral-300"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-center gap-6 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <LinkIcon className="h-3.5 w-3.5" /> Paste a YouTube link
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Refresh className="h-3.5 w-3.5" /> Ready in ~5 min
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}