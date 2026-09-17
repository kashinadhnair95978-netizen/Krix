import { ArrowRight, LinkIcon, Upload, Sparkle } from './icons';
import { Reveal } from './Reveal';
import Link from 'next/link';

const steps = [
  {
    number: '01',
    title: 'Drop in a video',
    description:
      'Paste a link from YouTube, Twitter, or any platform — or upload an MP4, MOV, or WebM. Long-form podcasts work too.',
    icon: <Upload className="h-5 w-5" />,
  },
  {
    number: '02',
    title: 'AI finds the gold',
    description:
      'Krix transcribes every second, detects hooks, and repurposes each moment into every format — in your brand voice.',
    icon: <Sparkle className="h-5 w-5" />,
  },
  {
    number: '03',
    title: 'Review, edit, publish',
    description:
      'Every output is editable inline. Copy, download, or send it straight to any platform — or automate it with our API.',
    icon: <LinkIcon className="h-5 w-5" />,
  },
];

export function HowItWorks() {
  return (
    <section id="workflow" className="relative overflow-hidden bg-black py-24 md:py-32">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-full w-px bg-gradient-to-b from-transparent via-white/[0.06] to-transparent" />

      <div className="relative mx-auto max-w-5xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="mb-4 inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
            Workflow automation
          </span>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-white md:text-5xl md:leading-tight">
            Your content pipeline — on autopilot.
          </h2>
          <p className="mt-5 text-lg text-neutral-400">
            Create and publish 5x faster with the web app and API, so you can
            keep your content rolling while you do anything else.
          </p>
        </Reveal>

        <ol className="mt-16 grid gap-6 md:mt-20 md:grid-cols-3 md:gap-5">
          {steps.map((step, i) => (
            <li key={step.number}>
              <Reveal delay={i * 100}>
                <div className="h-full rounded-3xl border border-white/10 bg-white/[0.02] p-8 transition-colors duration-300 hover:border-white/25 hover:bg-white/[0.04]">
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white">
                      {step.icon}
                    </div>
                    <div className="font-mono text-3xl font-semibold bg-gradient-to-b from-white/40 to-white/5 bg-clip-text text-transparent">
                      {step.number}
                    </div>
                  </div>
                  <h3 className="mt-6 text-xl font-semibold tracking-tight text-white">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-neutral-400">
                    {step.description}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>

        <Reveal delay={350} className="mt-16 text-center md:mt-24">
          <Link
            href="/auth/signup"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-white px-8 py-3.5 text-sm font-medium text-black transition-all duration-300 hover:scale-[1.03]"
          >
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-neutral-400/30 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
            />
            <span className="relative flex items-center gap-2">
              Try it free for 7 days
              <ArrowRight className="h-4 w-4 transition-transform duration-300 ease-out group-hover:translate-x-0.5" />
            </span>
          </Link>
          <p className="mt-4 text-xs text-neutral-600">
            No credit card required · Cancel anytime
          </p>
        </Reveal>
      </div>
    </section>
  );
}