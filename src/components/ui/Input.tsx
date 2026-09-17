import React from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  variant?: 'light' | 'dark';
}

export function Input({
  className,
  label,
  error,
  id,
  variant = 'light',
  ...props
}: InputProps) {
  const inputId = id || props.name;
  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className={cn(
            'block text-sm font-medium',
            variant === 'dark' ? 'text-neutral-300' : 'text-neutral-900'
          )}
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cn(
          'w-full rounded-xl border px-4 py-2.5 text-sm placeholder:text-neutral-500 focus:outline-none focus:ring-2 transition-colors',
          variant === 'dark'
            ? 'border-white/10 bg-white/[0.06] text-white focus:border-white/30 focus:ring-white/20'
            : 'border-neutral-300 bg-white text-neutral-900 focus:border-neutral-900 focus:ring-neutral-900',
          error && 'border-red-500 focus:ring-red-500',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}