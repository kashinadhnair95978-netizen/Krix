'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserSupabase } from '@/lib/supabase';
import { ArrowRight, LinkIcon, Upload } from './icons';

const supportedSources = [
  'YouTube',
  'Google Drive',
  'Vimeo',
  'Twitch',
  'Facebook',
  'LinkedIn',
  'Twitter',
  'Loom',
  'Riverside',
  'StreamYard',
];

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(normalizeUrl(value));
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function VideoLinkCTA() {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const go = async (nextPath: string) => {
    const finalLink = normalizeUrl(link);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('krix_pending_url', finalLink);
    }
    router.push(
      nextPath === '/dashboard/upload'
        ? `/dashboard/upload?url=${encodeURIComponent(finalLink)}`
        : nextPath
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!link.trim()) {
      setError('Drop a video link to get started.');
      return;
    }
    if (!isValidUrl(link)) {
      setError('That doesn\u2019t look like a valid URL yet. Try a YouTube, Vimeo or drive link.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await browserSupabase.auth.getUser();
      if (data.user) {
        await go('/dashboard/upload');
      } else {
        await go('/auth/signup');
      }
    } catch {
      await go('/auth/signup');
    }
  };

  const handleSendToUpload = async () => {
    const { data } = await browserSupabase.auth.getUser();
    if (data.user) {
      router.push('/dashboard/upload');
    } else {
      router.push('/auth/signup');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <form onSubmit={handleSubmit} className="relative">
        <LinkIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError('');
          }}
          placeholder="Drop a video link"
          aria-label="Video link"
          className="w-full rounded-full border border-white/15 bg-white/[0.06] py-4 pr-40 text-[15px] text-white placeholder-neutral-500 outline-none transition-colors duration-200 focus:border-white/40 focus:bg-white/[0.09]"
          style={{ paddingLeft: '3.25rem' }}
        />
        <button
          type="submit"
          disabled={loading}
          className="group absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-all duration-200 hover:bg-neutral-200 disabled:opacity-60"
        >
          {loading ? 'Jumping in…' : 'Get free clips'}
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      </form>

      {error && <p className="mt-3 text-center text-sm text-red-300">{error}</p>}

      <div className="mt-6 flex items-center justify-center gap-6 text-sm text-neutral-400">
        <span className="hidden h-px w-16 bg-white/10 sm:block" />
        <button
          onClick={handleSendToUpload}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-white/5"
        >
          <Upload className="h-4 w-4" />
          Upload files
        </button>
        <span className="hidden h-px w-16 bg-white/10 sm:block" />
      </div>

      <p className="mt-7 text-center text-xs text-neutral-600">
        We support videos from: {supportedSources.join(', ')} and more. Currently
        English, Spanish, French, German and 20+ other languages.
      </p>
    </div>
  );
}