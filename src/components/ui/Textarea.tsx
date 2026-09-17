import React from 'react';
import { cn } from '@/lib/utils';

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  variant?: 'light' | 'dark';
}

export function Textarea({
  className,
  label,
  error,
  id,
  variant = 'light',
  ...props
}: TextareaProps) {
  const textareaId = id || props.name;
  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={textareaId}
          className={cn(
            'block text-sm font-medium',
            variant === 'dark' ? 'text-neutral-300' : 'text-neutral-900'
          )}
        >
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={cn(
          'w-full rounded-lg border px-4 py-2 text-sm focus:outline-none focus:ring-2 transition-colors resize-none',
          variant === 'dark'
            ? 'border-white/10 bg-white/[0.06] text-white focus:border-white/30 focus:ring-white/20'
            : 'border-gray-300 bg-white text-neutral-900 focus:border-black focus:ring-black',
          error && 'border-red-500 focus:ring-red-500',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}