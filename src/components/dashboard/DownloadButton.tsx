'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

interface DownloadButtonProps {
  content?: string;
  filename?: string;
  label?: string;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md';
  onDownload?: () => void;
}

export function DownloadButton({
  content = '',
  filename = 'content.txt',
  label = 'Download',
  variant = 'secondary',
  size = 'md',
  onDownload,
}: DownloadButtonProps) {
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();

  const handleDownload = () => {
    setDownloading(true);
    try {
      if (onDownload) {
        onDownload();
      } else {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('Download started', 'success');
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className={cn(
        'rounded-lg text-sm font-medium transition-all active:scale-[0.97] disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5' : 'px-4 py-2',
        variant === 'primary'
          ? 'bg-white text-black hover:bg-neutral-200'
          : 'border border-white/15 text-neutral-200 hover:bg-white/10'
      )}
    >
      {downloading ? 'Preparing...' : `⭳ ${label}`}
    </button>
  );
}