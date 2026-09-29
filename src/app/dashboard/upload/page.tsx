'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { VideoUpload } from '@/components/dashboard/VideoUpload';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { apiClient, ingestErrorMessage } from '@/lib/api-client';

function isYouTubeVideoUrl(value: string): boolean {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return true;
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return false;
    if (u.searchParams.get('v')) return true;
    return ['shorts', 'embed', 'live', 'v'].includes(u.pathname.split('/').filter(Boolean)[0] ?? '');
  } catch {
    return false;
  }
}

function ImportingBanner({ url }: { url: string }) {
  const [state, setState] = useState<'working' | 'error'>('working');
  const [error, setError] = useState('');
  const started = useRef(false);
  const router = useRouter();

  useEffect(() => {
    // React 18 StrictMode double-invokes effects in dev; the ref plus the
    // in-flight guard in the client stop a duplicate server-side download.
    if (started.current) return;
    started.current = true;

    apiClient
      .ingestUrl(url)
      .then((res) => {
        const id = res.data?.videoId;
        if (id) router.replace(`/dashboard/content/${id}`);
        else if (res.data?.deduplicated) router.replace('/dashboard/videos');
        else setError('The import finished but no video was returned.');
        setState('error');
      })
      .catch((err) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 200 || status === 201 || status === 202) {
          router.replace('/dashboard/videos');
          return;
        }
        setError(ingestErrorMessage(err, 'Could not import that link.'));
        setState('error');
      });
  }, [url, router]);

  if (state === 'working') {
    return (
      <div className="mb-4 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm text-neutral-300">
        <span className="font-medium text-white">Importing video…</span>
        <p className="mt-1 break-all text-xs text-neutral-500">{url}</p>
        <p className="mt-2 text-xs text-neutral-500">
          Downloading on the server and starting the AI pipeline. This page will
          move to the video on its own.
        </p>
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <span className="font-medium">Import failed</span>
      <p className="mt-1 text-xs">{error}</p>
      <p className="mt-1 break-all text-xs text-neutral-500">{url}</p>
    </div>
  );
}

function UploadContent() {
  const searchParams = useSearchParams();
  const pendingUrl = searchParams.get('url') || '';
  const canImport = isYouTubeVideoUrl(pendingUrl);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Upload a video"
        subtitle="Drop a video or podcast and let AI turn it into 100 posts."
      />

      <div className="max-w-xl">
        {canImport ? (
          <ImportingBanner url={pendingUrl} />
        ) : pendingUrl ? (
          <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <span className="font-medium">Link import is not available for this
            source yet</span>
            <p className="mt-1 break-all text-xs opacity-80">{pendingUrl}</p>
            <p className="mt-1 text-xs opacity-80">
              YouTube links are imported automatically. For any other host, upload
              the file below instead.
            </p>
          </div>
        ) : null}
        <VideoUpload
          initialTitle={pendingUrl && !canImport ? `From: ${pendingUrl}` : undefined}
        />
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        <Card
          variant="dark"
          title="🏷️ Title & format"
          description="We auto-detect formats like MP4, MOV, WebM."
        />
        <Card
          variant="dark"
          title="⚡ Fast processing"
          description="Most videos are ready in under 60 seconds."
        />
        <Card
          variant="dark"
          title="🔒 Private by default"
          description="Your content stays yours — always."
        />
      </div>
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div className="animate-pulse" />}>
      <UploadContent />
    </Suspense>
  );
}
