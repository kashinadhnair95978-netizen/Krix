'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { RepurposedContent } from '@/components/dashboard/RepurposedContent';
import { Loading } from '@/components/ui/Loading';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/dashboard/StatusPill';
import { useInterval } from '@/lib/hooks';

export default function VideoContentPage({
  params,
}: {
  params: { videoId: string };
}) {
  const { videoId } = params;
  const [video, setVideo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [repurposing, setRepurposing] = useState(false);
  const [repurposeError, setRepurposeError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchVideo = useCallback(async () => {
    try {
      const response = await apiClient.getVideoById(videoId);
      setVideo(response.data);
    } catch (err: any) {
      setRepurposeError(
        err.response?.data?.message || 'Failed to load video'
      );
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    fetchVideo().finally(() => setLoading(false));
  }, [fetchVideo]);

  useInterval(fetchVideo, video?.status === 'processing' ? 6000 : null);

  const handleRepurpose = async () => {
    setRepurposing(true);
    setRepurposeError('');
    try {
      await apiClient.repurposeVideo(videoId);
      setVideo((prev: any) => ({ ...prev, status: 'completed' }));
      setRefreshKey((k: number) => k + 1);
    } catch (err: any) {
      setRepurposeError(
        err.response?.data?.message || 'Repurposing failed'
      );
    } finally {
      setRepurposing(false);
    }
  };

  if (loading) return <Loading text="Loading video..." />;

  if (!video && repurposeError) {
    return <div className="text-sm text-red-300">{repurposeError}</div>;
  }

  return (
    <div className="animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-bold tracking-tight text-white">
            {video?.title || 'Video'}
          </h1>
          <p className="mt-1 text-neutral-400">
            {video?.status === 'completed'
              ? 'Your repurposed content is ready below.'
              : video?.status === 'processing'
              ? 'This video is still processing.'
              : 'Repurpose this video into 100 pieces of content.'}
          </p>
        </div>
        {video && (
          <div className="flex shrink-0 items-center gap-3">
            <StatusPill status={video.status} />
            {video.status === 'failed' && (
              <Button inverse size="sm" onClick={handleRepurpose} loading={repurposing}>
                {repurposing ? 'Repurposing...' : 'Retry repurposing'}
              </Button>
            )}
            {video.status === 'completed' && (
              <Button
                size="sm"
                variant="outline"
                inverse
                onClick={handleRepurpose}
                loading={repurposing}
              >
                {repurposing ? 'Repurposing...' : 'Regenerate'}
              </Button>
            )}
          </div>
        )}
      </div>

      {video?.status === 'failed' && !repurposing && (
        <Card
          variant="dark"
          className="mt-6 border-amber-400/30 bg-amber-400/5"
        >
          <p className="text-sm text-amber-300">
            {video.error_message ||
              'Processing failed. Click "Retry repurposing" to try again.'}
          </p>
        </Card>
      )}

      <div className="mt-8">
        {video?.status === 'processing' ? (
          <Loading text="AI is processing your video..." />
        ) : (
          <RepurposedContent key={refreshKey} videoId={videoId} />
        )}
      </div>
    </div>
  );
}