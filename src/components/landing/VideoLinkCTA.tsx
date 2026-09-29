'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ingestErrorMessage } from '@/lib/api-client';
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

/** Only what the server actually implements today. */
const SUPPORTED_PROVIDERS = ['YouTube'];

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Cheap client-side sanity check; the server re-validates authoritatively. */
function looksLikeVideoUrl(value: string): boolean {
  try {
    const parsed = new URL(normalizeUrl(value));
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return parsed.hostname.length > 3 && parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

export function VideoLinkCTA() {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
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
    if (inFlight.current) return;
    setError('');

    if (!link.trim()) {
      setError('Drop a video link to get started.');
      return;
    }
    if (!looksLikeVideoUrl(link)) {
      setError('That doesn\u2019t look like a valid URL yet. Try a YouTube link like https://www.youtube.com/watch?v=…');
      return;
    }

    inFlight.current = true;
    setLoading(true);

    try {
      // Only a signed-in user can import — the endpoint is session-protected.
      const { data } = await browserSupabase.auth.getUser();
      if (!data.user) {
        await go('/auth/signup');
        return;
      }

      const res = await apiClient.ingestUrl(normalizeUrl(link));
      const result = res.data;

      if (result?.videoId) {
        router.push(`/dashboard/content/${result.videoId}`);
        return;
      }
      // A duplicate answered before the first import wrote a row still has a
      // deterministic answer: the library will show the job a moment later.
      if (result?.deduplicated) {
        router.push('/dashboard/videos');
        return;
      }
      setError('The import finished but no video was returned. Try again.');
    } catch (err) {
      // A duplicate import is not a failure — send the user to the live job.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 200 || status === 201 || status === 202) {
        router.push('/dashboard/videos');
        return;
      }
      setError(ingestErrorMessage(err, 'Could not import that link.'));
    } finally {
      inFlight.current = false;
      setLoading(false);
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

  const buttonLabel = loading ? 'Importing video…' : 'Get free clips';

  return (
    <div className="mx-auto max-w-2xl">
      <form onSubmit={handleSubmit} className="relative flex flex-col gap-2 sm:block">
        <div className="relative">
          <LinkIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setError('');
            }}
            onPaste={(e) => {
              // Paste the raw text, not the browser's URL-wrapped version.
              const text = e.clipboardData.getData('text');
              if (text && text !== link) {
                e.preventDefault();
                setLink(text);
                setError('');
              }
            }}
            placeholder="Drop a video link"
            aria-label="Video link"
            disabled={loading}
            className="w-full rounded-full border border-white/15 bg-white/[0.06] py-4 pr-5 text-[15px] text-white placeholder-neutral-500 outline-none transition-colors duration-200 focus:border-white/40 focus:bg-white/[0.09] disabled:opacity-60 sm:pr-40"
            style={{ paddingLeft: '3.25rem' }}
          />
          <button
            type="submit"
            disabled={loading}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-all duration-200 hover:bg-neutral-200 disabled:opacity-60 sm:flex"
          >
            {buttonLabel}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-1.5 rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition-all duration-200 hover:bg-neutral-200 disabled:opacity-60 sm:hidden"
        >
          {buttonLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      {loading && (
        <p className="mt-3 text-center text-sm text-neutral-400">
          Downloading the video on the server and starting the AI pipeline. This
          can take a minute for a longer video — keep this tab open.
        </p>
      )}

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
        Link import is live for <span className="text-neutral-400">{SUPPORTED_PROVIDERS.join(', ')}</span>{' '}
        today. {supportedSources.length - SUPPORTED_PROVIDERS.length > 0 && `We list ${supportedSources.join(', ')} as coming sources.`}{' '}
        Currently English, Spanish, French, German and 20+ other languages.
      </p>
    </div>
  );
}
