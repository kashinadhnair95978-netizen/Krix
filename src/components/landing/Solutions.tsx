import { Reveal } from './Reveal';
import { SpotlightCard } from './SpotlightCard';
import {
  Play,
  Mic,
  Megaphone,
  Home,
  Layers,
  Briefcase,
  ArrowUpRight,
  Sparkle,
  Hashtag,
  Globe,
  Video,
} from './icons';
import type { ReactNode } from 'react';

interface Solution {
  title: string;
  description: string;
  stat: string;
  icon: ReactNode;
}

const solutions: Solution[] = [
  {
    title: 'Creators',
    description:
      'Fastest way to gain your next 1 million views without burnout.',
    stat: '10x output',
    icon: <Play className="h-5 w-5" />,
  },
  {
    title: 'Podcasters',
    description:
      'Get your next 1 million views in weeks via consistent posting.',
    stat: '5x clips/day',
    icon: <Mic className="h-5 w-5" />,
  },
  {
    title: 'Advertisers',
    description:
      'Create high-performing ad creatives at scale from every asset you already have.',
    stat: '50+ variants',
    icon: <Megaphone className="h-5 w-5" />,
  },
  {
    title: 'Real estate',
    description:
      'Get more leads through shorts and become the top-selling realtor.',
    stat: '2x listings',
    icon: <Home className="h-5 w-5" />,
  },
  {
    title: 'Media & entertainment',
    description:
      'Streamline the video creation workflow and reach 10x more audiences.',
    stat: '10x reach',
    icon: <Layers className="h-5 w-5" />,
  },
  {
    title: 'Agencies',
    description:
      'Scale your business and save $2,700 monthly on editing costs per client.',
    stat: '-$2.7K/mo',
    icon: <Briefcase className="h-5 w-5" />,
  },
  {
    title: 'Church',
    description:
      'Evangelize digitally to reach more people and get more donations.',
    stat: '3x sermons',
    icon: <Globe className="h-5 w-5" />,
  },
  {
    title: 'Marketers',
    description:
      'Make every marketer a pro video editor — on-brand content at scale.',
    stat: '3x content',
    icon: <Sparkle className="h-5 w-5" />,
  },
  {
    title: 'Livestreamers',
    description:
      'Drive more traffic back to your livestreams through shorts.',
    stat: '4x watch',
    icon: <Hashtag className="h-5 w-5" />,
  },
  {
    title: 'E-commerce',
    description:
      'Sell more products and increase exposure with viral shorts.',
    stat: '2x conversions',
    icon: <Video className="h-5 w-5" />,
  },
];

export function Solutions() {
  return (
    <section id="solutions" className="relative overflow-hidden bg-black py-24 md:py-32">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[320px] w-[720px] -translate-x-1/2 rounded-full bg-white/[0.03] blur-[120px]" />

      <div className="relative mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="mb-4 inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
            Solutions
          </span>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-white md:text-5xl md:leading-tight">
            Built for the way you create.
          </h2>
          <p className="mt-5 text-lg text-neutral-400">
            Whether you record solo or run a media team, Krix fits your workflow — and your growth goals.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 md:mt-16 lg:grid-cols-3 xl:grid-cols-4">
          {solutions.map((solution, i) => (
            <Reveal key={solution.title} delay={i * 50}>
              <SpotlightCard className="group h-full border border-white/10 bg-white/[0.02] transition-colors duration-300 hover:border-white/25 hover:bg-white/[0.04]">
                <div className="flex h-full flex-col p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition-all duration-300 group-hover:border-white/30 group-hover:bg-white group-hover:text-black">
                      {solution.icon}
                    </div>
                    <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 transition-colors group-hover:border-white/25 group-hover:text-neutral-300">
                      {solution.stat}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight text-white">
                    {solution.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                    {solution.description}
                  </p>
                  <span className="mt-auto inline-flex items-center gap-1 pt-4 text-xs font-medium text-neutral-500 transition-colors group-hover:text-white">
                    Explore {solution.title.toLowerCase()}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}