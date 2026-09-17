import { VideoLinkCTA } from './VideoLinkCTA';

export function CTA() {
  return (
    <section className="relative overflow-hidden border-y border-white/10 bg-gradient-to-b from-[#0d0d0f] to-black py-20 md:py-24">
      {/* soft warm glow */}
      <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-white/[0.05] blur-[100px]" />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <span className="mb-5 inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
          Get started
        </span>
        <h2 className="text-balance text-4xl font-semibold tracking-tight text-white md:text-5xl md:leading-[1.08]">
          Your next viral post is one link away.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-neutral-400">
          Paste a video link or upload a file — Krix turns it into a month of
          clips, posts, and emails.
        </p>

        <div className="mt-10">
          <VideoLinkCTA />
        </div>

        <p className="mt-8 text-xs text-neutral-500">
          7-day free trial · No credit card required · Cancel anytime
        </p>
      </div>
    </section>
  );
}