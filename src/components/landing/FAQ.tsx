'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Plus } from './icons';

const faqs = [
  {
    q: 'How does Krix work?',
    a: 'Krix analyzes your video in context of current social and marketing trends, finds the highlight moments, and rearranges them into viral-worthy shorts and posts — polished with dynamic captions, AI relayout, and smooth transitions, ending with a strong call-to-action.',
  },
  {
    q: 'What types of videos can I upload?',
    a: 'Any video you have. Whether it\u2019s talking-head videos like podcasts and interviews, vlogs, sports, TV shows, or videos with little to no dialogue, Krix understands the visual, audio and sentiment cues and clips the best moments. You can paste a direct link or upload an MP4, MOV, or WebM.',
  },
  {
    q: 'Which languages are supported?',
    a: 'English, German, Spanish, French, Portuguese, Italian, Dutch, Russian, Polish, Indonesian, Ukrainian, Swedish, Turkish, Norwegian, and more to come.',
  },
  {
    q: 'Can I edit the captions and outputs?',
    a: 'Absolutely. Krix auto-adds captions at over 97% accuracy, and every short, tweet, blog, or post is fully editable inline before you publish.',
  },
  {
    q: 'Is Krix free to use?',
    a: 'Yes. New users get a 7-day free trial with full credits. When the trial ends you can upgrade to a paid plan or keep using our free-forever tier with monthly credits.',
  },
  {
    q: 'I have more questions!',
    a: 'Email us at support@krix.app or reach out in-app — we\u2019re happy to help.',
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="bg-black py-24 md:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-white md:text-5xl md:leading-tight">
            Frequently asked questions.
          </h2>
        </div>

        <div className="mt-14">
          {faqs.map((faq, i) => {
            const open = openIndex === i;
            return (
              <div key={i} className="border-b border-white/10">
                <button
                  onClick={() => setOpenIndex(open ? null : i)}
                  className="group flex w-full items-center justify-between gap-6 py-6 text-left"
                  aria-expanded={open}
                >
                  <span
                    className={cn(
                      'text-lg font-medium tracking-tight transition-colors',
                      open
                        ? 'text-white'
                        : 'text-neutral-300 group-hover:text-white'
                    )}
                  >
                    {faq.q}
                  </span>
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all duration-300',
                      open
                        ? 'border-white bg-white text-black'
                        : 'border-white/15 text-neutral-500 group-hover:border-neutral-500'
                    )}
                  >
                    <Plus
                      className={cn(
                        'h-4 w-4 transition-transform duration-300',
                        open && 'rotate-45'
                      )}
                    />
                  </span>
                </button>
                <div
                  className={cn(
                    'grid transition-all duration-300 ease-out',
                    open
                      ? 'grid-rows-[1fr] pb-6 opacity-100'
                      : 'grid-rows-[0fr] opacity-0'
                  )}
                >
                  <p className="overflow-hidden pr-10 text-[15px] leading-relaxed text-neutral-400">
                    {faq.a}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}