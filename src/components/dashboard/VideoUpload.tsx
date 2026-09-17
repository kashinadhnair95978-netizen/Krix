'use client';

import { useState, useRef } from 'react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

export function VideoUpload({ initialTitle }: { initialTitle?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(initialTitle || '');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title || file.name.replace(/\.[^.]+$/, ''));

      await apiClient.uploadVideo(formData);
      setFile(null);
      setTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast('Video uploaded — AI is processing it now.', 'success');
    } catch (err: any) {
      toast(err.response?.data?.message || 'Upload failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.type.startsWith('video/')) {
      setFile(dropped);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div
        className={`relative overflow-hidden rounded-3xl border-2 border-dashed p-10 text-center transition-all ${
          dragging
            ? 'border-white/50 bg-white/[0.08]'
            : 'border-white/15 bg-white/[0.03] hover:border-white/30'
        } cursor-pointer`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="hidden"
          id="file-input"
          accept="video/*"
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
            MP4, MOV, WebM · up to 2GB
          </p>
        </label>
      </div>

      {file && (
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

      <Input
        label="Video title"
        variant="dark"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
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
        {loading ? 'Uploading...' : 'Upload & process'}
      </Button>
    </form>
  );
}