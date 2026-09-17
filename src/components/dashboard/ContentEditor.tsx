'use client';

import { useState } from 'react';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';

interface ContentEditorProps {
  initialText: string;
  placeholder?: string;
  onSave?: (text: string) => void;
  onCancel?: () => void;
}

export function ContentEditor({
  initialText,
  placeholder,
  onSave,
  onCancel,
}: ContentEditorProps) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave?.(text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={8}
        variant="dark"
        className="font-mono text-sm"
      />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" inverse size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button inverse size="sm" loading={saving} onClick={handleSave}>
          Save changes
        </Button>
      </div>
    </div>
  );
}