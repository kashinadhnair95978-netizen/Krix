'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { VideoUpload } from '@/components/dashboard/VideoUpload';
import { PageHeader } from '@/components/dashboard/PageHeader';

function UploadContent() {
  const searchParams = useSearchParams();
  const pendingUrl = searchParams.get('url') || '';

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Upload a video"
        subtitle="Drop a video or podcast and let AI turn it into 100 posts."
      />

      <div className="max-w-xl">
        {pendingUrl && (
          <div className="mb-4 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm text-neutral-300">
            <span className="font-medium text-white">Link captured</span> ·{' '}
            <span className="break-all">{pendingUrl}</span>
          </div>
        )}
        <VideoUpload initialTitle={pendingUrl ? `From: ${pendingUrl}` : undefined} />
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