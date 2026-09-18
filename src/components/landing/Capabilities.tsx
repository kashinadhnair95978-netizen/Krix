import {
  Briefcase,
  Document,
  Hashtag,
  ImageIcon,
  Mail,
  Play,
  Captions,
  Refresh,
  Scissors,
  Sparkle,
  ArrowUpRight,
  Clapperboard,
  Wand,
  CalendarIcon,
  ExportIcon,
  Palette,
  Users,
  Terminal,
  Bot,
  LayoutGrid,
} from './icons';
import { SpotlightCard } from './SpotlightCard';
import { Reveal } from './Reveal';
import { ComingSoon } from '@/components/ui/ComingSoon';
import type { ReactNode } from 'react';

interface Model {
  title: string;
  tag?: string;
  description: string;
  bullets: string[];
  icon: ReactNode;
}

const models: Model[] = [
  {
    title: 'AI Producer',
    tag: 'New',
    description:
      'Turn your raw footage into a polished, ready-to-post video — automatic captions, transitions, music, and motion design.',
    bullets: ['Fine cut in minutes', 'Music & SFX synced', 'Zero editing skills'],
    icon: <Clapperboard className="h-5 w-5" />,
  },
  {
    title: 'ClipAnything',
    description:
      'The fastest way to turn any video into viral shorts — the only clipping model that works on every genre, surfacing the moments people rewatch.',
    bullets: ['Any genre, in one click', 'Hook-first clip selection', 'Auto-captions at 97% accuracy'],
    icon: <Scissors className="h-5 w-5" />,
  },
  {
    title: 'AI B-Roll',
    tag: 'New',
    description:
      'Get relevant AI B-Roll in 1 click, under 1 minute. Context-aware stock footage or custom uploads that boost watch time.',
    bullets: ['1 click · under 1 minute', 'Millions of stock clips', 'Custom B-Roll upload'],
    icon: <Wand className="h-5 w-5" />,
  },
  {
    title: 'AI Reframe',
    tag: 'Updated',
    description:
      'Resize any video for every platform in 1 click — keeps moving subjects centered with AI object tracking.',
    bullets: ['Vertical, square & wide', 'AI subject tracking', 'Manual follow control'],
    icon: <Refresh className="h-5 w-5" />,
  },
];

interface Tool {
  title: string;
  tag?: string;
  description: string;
  icon: ReactNode;
}

const tools: Tool[] = [
  {
    title: 'Editor',
    tag: 'Updated',
    description:
      'All-in-one AI editor. Text-based and timeline editing with trim, extend, filler-word removal, and overlays.',
    icon: <Play className="h-5 w-5" />,
  },
  {
    title: 'Animated captions',
    description:
      'The fastest way to add animated captions with 97%+ accuracy and templates to choose from.',
    icon: <Captions className="h-5 w-5" />,
  },
  {
    title: 'Social scheduler',
    description:
      "Schedule a month's posts to all platforms — YouTube, TikTok, Instagram, X, Facebook, LinkedIn — in 10 minutes.",
    icon: <CalendarIcon className="h-5 w-5" />,
  },
  {
    title: 'Export to XML',
    description:
      'Edit in Adobe Premiere Pro or DaVinci Resolve at ease — export any clip to continue your creative work.',
    icon: <ExportIcon className="h-5 w-5" />,
  },
  {
    title: 'Thumbnail generator',
    tag: 'New',
    description:
      'Drop a link and get a YouTube thumbnail in 1 click — AI-designed, click-worthy, brand-safe.',
    icon: <ImageIcon className="h-5 w-5" />,
  },
  {
    title: 'Brand template',
    description:
      'Easily create and add brand templates in 1 click — fonts, colors, logo, intro and outro.',
    icon: <Palette className="h-5 w-5" />,
  },
  {
    title: 'Team workspace',
    description:
      'Maximize your team\u2019s productivity with AI — assign roles, review clips, and manage projects together.',
    icon: <Users className="h-5 w-5" />,
  },
];

interface Workflow {
  title: string;
  tag?: string;
  description: string;
  cta: string;
  icon: ReactNode;
  comingSoon?: boolean;
}

const workflows: Workflow[] = [
  {
    title: 'API',
    description:
      'The video API every AI agent can call. Generate clips, apply editing scripts, captions, thumbnails and social copy programmatically.',
    cta: 'Explore the docs',
    icon: <Terminal className="h-5 w-5" />,
  },
  {
    title: 'MCP',
    tag: 'New',
    description:
      'The video MCP any AI agent workflow can use. Connect your agent to clip, caption, reframe, schedule and publish — over one protocol.',
    cta: 'View server examples',
    icon: <Bot className="h-5 w-5" />,
    comingSoon: true,
  },
  {
    title: 'Inspiration gallery',
    description:
      'See what you can build with the Krix MCP — workflows, automations, and integrations from the community.',
    cta: 'Browse the gallery',
    icon: <LayoutGrid className="h-5 w-5" />,
  },
];

const formats = [
  { title: 'YouTube Shorts', description: 'Highlight clips cut at the perfect moment, captioned and ready to upload.', icon: <Play className="h-5 w-5" /> },
  { title: 'Twitter / X', description: 'A dozen tweet variations written in your voice, tuned for engagement.', icon: <Hashtag className="h-5 w-5" /> },
  { title: 'Blog posts', description: 'SEO-friendly outlines and first drafts built directly from the transcript.', icon: <Document className="h-5 w-5" /> },
  { title: 'Email sequences', description: 'A five-email nurture sequence your list will actually open and read.', icon: <Mail className="h-5 w-5" /> },
  { title: 'LinkedIn posts', description: 'Professional hooks and insights threaded through your story.', icon: <Briefcase className="h-5 w-5" /> },
  { title: 'Thumbnails & hooks', description: 'Click-worthy visuals and opening lines designed to stop the scroll.', icon: <ImageIcon className="h-5 w-5" /> },
];

function Badge({ children }: { children: string }) {
  return (
    <span className="mb-4 inline-flex w-fit items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
      {children}
    </span>
  );
}

export function Capabilities() {
  return (
    <section id="capabilities" className="relative overflow-hidden bg-[#0d0d0f] py-24 md:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black_15%,transparent_72%)]"
      />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[680px] -translate-x-1/2 rounded-full bg-white/[0.04] blur-[120px]" />

      <div className="relative mx-auto max-w-5xl px-6">
        {/* AI editing models */}
        <Reveal className="mx-auto max-w-2xl text-center">
          <Badge>AI editing models</Badge>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-white md:text-5xl md:leading-tight">
            AI that understands every frame.
          </h2>
          <p className="mt-5 text-lg text-neutral-400">
            Powerful models that work on any video. Built for speed, accuracy, and
            creative flexibility.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 md:mt-20 lg:grid-cols-2">
          {models.map((model, i) => (
            <Reveal key={model.title} delay={i * 100}>
              <SpotlightCard className="h-full border border-white/10 bg-white/[0.02] transition-colors duration-300 hover:border-white/25 hover:bg-white/[0.04]">
                <div className="flex h-full flex-col p-8">
                  <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white shadow-inner transition-all duration-300 group-hover:scale-110 group-hover:border-white/30 group-hover:bg-white group-hover:text-black group-hover:shadow-[0_0_30px_rgba(255,255,255,0.22)]">
                      {model.icon}
                    </div>
                    {model.tag && (
                      <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-black">
                        {model.tag}
                      </span>
                    )}
                  </div>
                  <h3 className="text-2xl font-semibold tracking-tight text-white">
                    {model.title}
                  </h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-neutral-400">
                    {model.description}
                  </p>
                  <ul className="mt-6 space-y-2.5 border-t border-white/10 pt-6">
                    {model.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-center gap-2.5 text-sm text-neutral-300">
                        <Sparkle className="h-3.5 w-3.5 shrink-0 text-white/60" />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                </div>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>

        {/* Editor & tools */}
        <Reveal className="mx-auto mt-24 max-w-2xl text-center md:mt-32">
          <Badge>Editor &amp; tools</Badge>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-white md:text-5xl md:leading-tight">
            Clip, edit, post, analyze.
          </h2>
          <p className="mt-5 text-lg text-neutral-400">
            No more app-hopping or paying for separate tools. Everything you need,
            all in one platform.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 md:mt-16 lg:grid-cols-3">
          {tools.map((tool, i) => (
            <Reveal key={tool.title} delay={i * 60}>
              <SpotlightCard className="h-full border border-white/10 bg-black transition-colors duration-300 hover:border-white/25 hover:bg-white/[0.04]">
                <div className="flex h-full flex-col p-7">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition-all duration-300 group-hover:border-white/30 group-hover:bg-white group-hover:text-black">
                      {tool.icon}
                    </div>
                    {tool.tag && (
                      <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                        {tool.tag}
                      </span>
                    )}
                  </div>
                  <h4 className="mb-2 text-[16px] font-semibold tracking-tight text-white">
                    {tool.title}
                  </h4>
                  <p className="text-sm leading-relaxed text-neutral-400">
                    {tool.description}
                  </p>
                  <span className="mt-auto pt-5 text-[11px] font-medium uppercase tracking-widest text-neutral-600">
                    <Sparkle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                    AI powered
                  </span>
                </div>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>

        {/* Six formats automated end-to-end */}
        <div className="mt-20 md:mt-28">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h3 className="text-balance text-2xl font-semibold tracking-tight text-white md:text-3xl">
              Every platform gets what it does best.
            </h3>
            <p className="mt-4 text-[15px] leading-relaxed text-neutral-400">
              Written, designed, and scheduled for you — from one upload.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {formats.map((format, i) => (
              <Reveal key={format.title} delay={i * 70}>
                <SpotlightCard className="h-full border border-white/10 bg-black transition-colors duration-300 hover:border-white/25 hover:bg-white/[0.04]">
                  <div className="flex h-full flex-col p-7">
                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition-all duration-300 group-hover:border-white/30 group-hover:bg-white group-hover:text-black">
                      {format.icon}
                    </div>
                    <h4 className="mb-2 text-[16px] font-semibold tracking-tight text-white">
                      {format.title}
                    </h4>
                    <p className="text-sm leading-relaxed text-neutral-400">
                      {format.description}
                    </p>
                    <span className="mt-auto pt-5 text-[11px] font-medium uppercase tracking-widest text-neutral-600">
                      <Captions className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                      AI generated
                    </span>
                  </div>
                </SpotlightCard>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Agentic workflows */}
        <div className="mt-24 md:mt-32">
          <Reveal className="mx-auto max-w-2xl text-center">
            <Badge>Agentic workflows</Badge>
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-white md:text-5xl md:leading-tight">
              Your AI agent, your video pipeline.
            </h2>
            <p className="mt-5 text-lg text-neutral-400">
              Connect Krix to the tools and agents you already use — clip, edit,
              schedule, and publish on autopilot.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-5 md:mt-16 md:grid-cols-3">
            {workflows.map((workflow, i) => (
              <Reveal key={workflow.title} delay={i * 90}>
                <SpotlightCard className="h-full border border-white/10 bg-white/[0.02] transition-colors duration-300 hover:border-white/25 hover:bg-white/[0.04]">
                  <div className="flex h-full flex-col p-8">
                    <div className="mb-6 flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition-all duration-300 group-hover:bg-white group-hover:text-black">
                        {workflow.icon}
                      </div>
                      {workflow.tag && (
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-black">
                          {workflow.tag}
                        </span>
                      )}
                    </div>
                    <h3 className="text-xl font-semibold tracking-tight text-white">
                      {workflow.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-neutral-400">
                      {workflow.description}
                    </p>
                    <span className="group/link mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-medium text-white">
                      {workflow.comingSoon ? (
                        <ComingSoon className="inline-flex items-center gap-1.5">
                          {workflow.cta} <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Soon</span>
                          <ArrowUpRight className="h-4 w-4" />
                        </ComingSoon>
                      ) : (
                        <>
                          {workflow.cta}
                          <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
                        </>
                      )}
                    </span>
                  </div>
                </SpotlightCard>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}