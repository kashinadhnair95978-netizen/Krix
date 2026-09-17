'use client';

import { useMemo, useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { ContentEditor } from './ContentEditor';
import { DownloadButton } from './DownloadButton';
import { useToast } from '@/components/ui/Toast';

interface ContentItem {
  id: string;
  video_id: string;
  content_type: string;
  content_text: string;
  is_edited: boolean;
  created_at: string;
}

const typeLabels: Record<string, string> = {
  shorts: 'YouTube Shorts',
  tweets: 'Twitter/X Posts',
  blog: 'Blog Outlines',
  emails: 'Email Sequences',
  linkedin: 'LinkedIn Posts',
  thumbnails: 'Thumbnails',
  hooks: 'Hooks',
};

const typeIcons: Record<string, string> = {
  shorts: '📱',
  tweets: '𝕏',
  blog: '📝',
  emails: '✉️',
  linkedin: '💼',
  thumbnails: '🖼️',
  hooks: '🎣',
};

export function RepurposedContent({ videoId }: { videoId: string }) {
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string>('all');
  const { toast } = useToast();

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const response = await apiClient.getContent(videoId);
        setContent(response.data);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to fetch content');
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [videoId]);

  const types = useMemo(() => {
    const present = Array.from(new Set(content.map((c) => c.content_type)));
    return ['all', ...present];
  }, [content]);

  const visible = useMemo(
    () =>
      activeType === 'all'
        ? content
        : content.filter((c) => c.content_type === activeType),
    [content, activeType]
  );

  const handleCopy = async (item: ContentItem) => {
    try {
      await navigator.clipboard.writeText(item.content_text);
      setCopied(item.id);
      toast('Copied to clipboard', 'success');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast('Clipboard is not available', 'error');
    }
  };

  const handleCopyAll = async () => {
    const text = visible
      .map((c) =>
        `${typeLabels[c.content_type] || c.content_type}\n\n${c.content_text}`
      )
      .join('\n\n─────\n\n');
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${visible.length} pieces of content`, 'success');
    } catch {
      toast('Clipboard is not available', 'error');
    }
  };

  const handleDownloadAll = () => {
    const text = visible
      .map((c) =>
        `${typeLabels[c.content_type] || c.content_type}\n\n${c.content_text}`
      )
      .join('\n\n─────\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'krix-content.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`Downloaded ${visible.length} pieces of content`, 'success');
  };

  const handleSaveEdit = async (item: ContentItem, newText: string) => {
    try {
      await apiClient.updateContent(item.id, {
        content_text: newText,
        is_edited: true,
      });
      setContent((prev) =>
        prev.map((c) =>
          c.id === item.id
            ? { ...c, content_text: newText, is_edited: true }
            : c
        )
      );
      setEditingId(null);
      toast('Changes saved', 'success');
    } catch (err) {
      toast('Failed to save changes', 'error');
    }
  };

  const handleDelete = async (item: ContentItem) => {
    if (!confirm('Delete this piece of content?')) return;
    try {
      await apiClient.deleteContent(item.id);
      setContent((prev) => prev.filter((c) => c.id !== item.id));
      toast('Content deleted', 'success');
    } catch (err) {
      toast('Failed to delete content', 'error');
    }
  };

  if (loading) return <Loading text="Loading repurposed content..." />;
  if (error) return <div className="text-sm text-red-300">{error}</div>;

  if (content.length === 0) {
    return (
      <div className="py-12 text-center text-neutral-500">
        <div className="mb-2 text-4xl">✨</div>
        <p className="mb-4">No repurposed content yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {types.map((type) => (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition-all ${
                activeType === type
                  ? 'bg-white text-black'
                  : 'text-neutral-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {type === 'all'
                ? 'All'
                : (typeLabels[type] || type).replace(/s$/, '')}
              <span
                className={
                  activeType === type
                    ? 'ml-1.5 opacity-60 tabular-nums'
                    : 'ml-1.5 text-neutral-600 tabular-nums'
                }
              >
                {type === 'all'
                  ? content.length
                  : content.filter((c) => c.content_type === type).length}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyAll}
            className="rounded-lg border border-white/15 px-3.5 py-2 text-sm text-neutral-200 transition-colors hover:bg-white/10"
          >
            📋 Copy all
          </button>
          <DownloadButton
            variant="primary"
            label="Download all"
            content=""
            onDownload={handleDownloadAll}
            filename="krix-content.txt"
          />
        </div>
      </div>

      <div className="space-y-6">
        {visible.map((item) => (
          <Card key={item.id} variant="dark">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">
                  {typeIcons[item.content_type] || '📄'}
                </span>
                <h3 className="font-semibold text-white">
                  {typeLabels[item.content_type] || item.content_type}
                </h3>
                {item.is_edited && (
                  <span className="rounded-full bg-blue-400/10 px-2.5 py-0.5 text-xs font-medium text-blue-300 ring-1 ring-blue-400/30">
                    Edited
                  </span>
                )}
              </div>
            </div>

            {editingId === item.id ? (
              <div className="mt-4">
                <ContentEditor
                  initialText={item.content_text}
                  onSave={(text) => handleSaveEdit(item, text)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <>
                <div className="mt-4 max-h-60 overflow-auto rounded-xl border border-white/10 bg-black/40 p-4">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-300">
                    {item.content_text}
                  </pre>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setEditingId(item.id);
                      setCopied(null);
                    }}
                    className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-white/10"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleCopy(item)}
                    className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-white/10"
                  >
                    {copied === item.id ? '✓ Copied' : '📋 Copy'}
                  </button>
                  <DownloadButton
                    content={item.content_text}
                    filename={`${(typeLabels[item.content_type] || item.content_type)
                      .toLowerCase()
                      .replace(/\s+/g, '-')}.txt`}
                  />
                  <button
                    onClick={() => handleDelete(item)}
                    className="ml-auto rounded-lg border border-red-400/20 px-4 py-2 text-sm text-red-300 transition-colors hover:bg-red-400/10"
                  >
                    🗑 Delete
                  </button>
                </div>
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}