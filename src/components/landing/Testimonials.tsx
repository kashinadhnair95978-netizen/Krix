import { Quote, ArrowUpRight } from './icons';
import { Reveal } from './Reveal';

const stats = [
  { value: '+266%', label: 'shown-in-feed impressions' },
  { value: '+57%', label: 'watch time' },
  { value: '1→3%', label: 'to 12%+ full-view rate' },
  { value: '2×', label: 'views in the first 30 days' },
];

const testimonials = [
  {
    name: 'Mia Alvarez',
    role: 'Podcast host · 120K subs',
    quote:
      'Every episode used to take days to break into clips. Now it takes minutes — and the captions are flawless.',
  },
  {
    name: 'Devon West',
    role: 'YouTuber · 410K subs',
    quote:
      'Krix got my hook right the first time. Shorts that used to underperform now carry the whole channel.',
  },
  {
    name: 'Priya Nair',
    role: 'B2B agency founder',
    quote:
      'One webinar in, a month of LinkedIn and blog content out. The AI sounds uncannily like our brand.',
  },
  {
    name: 'Jon Reyes',
    role: 'Streamer · 1.2M followers',
    quote:
      'I clip my streams at 2am and let Krix do the rest. Wake up to a week of shorts already scheduled.',
  },
  {
    name: 'Hana Kim',
    role: 'Newsletter author',
    quote:
      'Turned my long-form interviews into an email sequence and my open rates jumped 30%.',
  },
  {
    name: 'Sam Osei',
    role: 'Video-first marketing lead',
    quote:
      'We repurpose every webinar for six platforms. Output quality is eerily consistent.',
  },
];

function TestimonialCard({ t }: { t: (typeof testimonials)[number] }) {
  return (
    <figure className="w-[320px] shrink-0 rounded-3xl border border-white/10 bg-[#0d0d0f] p-7 sm:w-[380px]">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black">
        <Quote className="h-4 w-4" />
      </div>
      <blockquote className="mt-4 text-[15px] leading-relaxed text-neutral-300">
        {t.quote}
      </blockquote>
      <figcaption className="mt-6 flex items-center gap-3 border-t border-white/10 pt-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-neutral-500 to-neutral-800 text-xs font-semibold text-white">
          {t.name.split(' ').map((n) => n[0]).join('')}
        </span>
        <span>
          <span className="block text-sm font-semibold text-white">{t.name}</span>
          <span className="block text-xs text-neutral-500">{t.role}</span>
        </span>
      </figcaption>
    </figure>
  );
}

export function Testimonials() {
  return (
    <section id="testimonials" className="bg-[#0d0d0f] py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="mb-4 inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
            From top creators
          </span>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-white md:text-5xl md:leading-tight">
            A partner to your growth.
          </h2>
          <p className="mt-5 text-lg text-neutral-400">
            The only editor that actually drives growth. Just ask the creators
            growing with Krix.
          </p>
        </Reveal>

        <Reveal delay={100} className="mt-14">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-white/10 bg-black p-6 text-center"
              >
                <div className="flex items-center justify-center gap-1 text-3xl font-semibold tracking-tight text-white tabular-nums">
                  {stat.value}
                  <ArrowUpRight className="h-5 w-5 text-green-400" />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-neutral-500">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        <div className="mt-14 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="flex w-max animate-marquee-x gap-5">
            {[...testimonials, ...testimonials].map((t, i) => (
              <TestimonialCard key={`${t.name}-${i}`} t={t} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}