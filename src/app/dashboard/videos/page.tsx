'use client';

import { Card } from '@/components/ui/Card';
import { VideoLibrary } from '@/components/dashboard/VideoLibrary';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function VideosPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Your videos"
        subtitle="All your uploaded content and repurposing status."
      />

      <Card variant="dark" className="max-w-3xl border-white/10">
        <VideoLibrary />
      </Card>
    </div>
  );
}