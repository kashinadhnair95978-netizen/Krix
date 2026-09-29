'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ingestErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

type Phase = 'idle' | 'uploading' | 'finalizing';

export function VideoUpload({ initialTitle }: { initialTitle?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(initialTitle || '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [maxBytes, setMaxBytes] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const router = useRouter();
  const { toast } = useToast();

  const loading = phase !== 'idle';

  // Ask the server what it can actually store, so an over-size file is caught
  // on selection instead of after the browser has pushed hundreds of MB.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getUploadLimits()
      .then((res) => {
        if (!cancelled && res.data?.maxBytes) setMaxBytes(res.data.maxBytes);
      })
      .catch(() => {
        /* limits are advisory; the server still enforces them */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tooLarge = useCallback(
    (f: File) => !!maxBytes && f.size > maxBytes,
    [maxBytes]
  );

  const pickFile = useCallback(
    (f: File | null) => {
      setError('');
      setProgress(0);
      if (!f) {
        setFile(null);
        return;
      }
      if (tooLarge(f)) {
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setError(
          `That file is ${(f.size / (1024 * 1024)).toFixed(1)} MB, over the ` +
            `${Math.floor((maxBytes as number) / (1024 * 1024))} MB limit of this project. ` +
            `Nothing was uploaded. Import it as a link or trim it first.`
        );
        return;
      }
      setFile(f);
    },
    [maxBytes, tooLarge]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guards against a double-submit while the request is in flight.
    if (!file || inFlight.current) return;

    if (tooLarge(file)) {
      setError(
        `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB, over the ` +
          `${Math.floor((maxBytes as number) / (1024 * 1024))} MB limit.`
      );
      return;
    }

    inFlight.current = true;
    setError('');
    setProgress(0);
    setPhase('uploading');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title || file.name.replace(/\.[^.]+$/, ''));

      const { data } = await apiClient.uploadVideo(formData, setProgress);

      // Bytes are sent; the server is storing the object and creating the row.
      setPhase('finalizing');
      setProgress(100);

      setFile(null);
      setTitle('');
      setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';

      toast(
        data?.pipelineTriggered === false
          ? 'Video uploaded, but processing could not start. Open the video to retry.'
          : 'Video uploaded — AI is processing it now.',
        data?.pipelineTriggered === false ? 'error' : 'success'
      );

      if (data?.videoId) router.push(`/dashboard/content/${data.videoId}`);
      else router.push('/dashboard/videos');
    } catch (err) {
      setPhase('idle');
      setProgress(0);
      const message = ingestErrorMessage(err, 'Upload failed');
      setError(message);
      toast(message, 'error');
    } finally {
      inFlight.current = false;
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (inFlight.current) return;
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (!(dropped.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(dropped.name))) {
      setError('That is not a video file. Upload an MP4, MOV or WebM.');
      return;
    }
    pickFile(dropped);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!inFlight.current) setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  const phaseLabel =
    phase === 'uploading'
      ? progress < 100
        ? `Uploading… ${progress}%`
        : 'Uploading… processing the file'
      : 'Finishing up…';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div
        className={`relative overflow-hidden rounded-3xl border-2 border-dashed p-6 text-center transition-all sm:p-10 ${
          dragging
            ? 'border-white/50 bg-white/[0.08]'
            : 'border-white/15 bg-white/[0.03] hover:border-white/30'
        } ${loading ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            if (!inFlight.current) pickFile(e.target.files?.[0] || null);
          }}
          className="hidden"
          id="file-input"
          accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
          disabled={loading}
        />
        <label htmlFor="file-input" className="block cursor-pointer">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-2xl">
            🎬
          </div>
          <p className="mt-4 font-medium text-white">
            {dragging
              ? 'Drop it now'
              : 'Click to upload or drag and drop'}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            MP4, MOV, WebM ·{' '}
            {maxBytes
              ? `up to ${Math.floor(maxBytes / (1024 * 1024))} MB on this project`
              : 'checking the size limit…'}
          </p>
        </label>
      </div>

      {file && !loading && (
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">
              {file.name}
            </p>
            <p className="text-xs text-neutral-500">
              {(file.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          </div>
          <span className="ml-3 shrink-0 rounded-full bg-green-400/10 px-2.5 py-1 text-xs font-medium text-green-300 ring-1 ring-green-400/30">
            ✓ Attached
          </span>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="truncate font-medium text-white">
              {file?.name}
            </span>
            <span className="ml-3 shrink-0 tabular-nums text-neutral-400">
              {phaseLabel}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white transition-[width] duration-300"
              style={{
                width: `${phase === 'finalizing' ? 100 : Math.max(2, progress)}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            {phase === 'finalizing'
              ? 'Storing the video and starting the AI pipeline…'
              : 'Keep this tab open. If the request stalls, a timeout will report it instead of hanging.'}
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </p>
      )}

      <Input
        label="Video title"
        variant="dark"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={loading}
        placeholder={file ? file.name.replace(/\.[^.]+$/, '') : 'My awesome video'}
      />

      <Button
        type="submit"
        inverse
        disabled={!file || loading}
        className="w-full"
        loading={loading}
        size="lg"
      >
        {loading ? phaseLabel : 'Upload & process'}
      </Button>
    </form>
  );
}
