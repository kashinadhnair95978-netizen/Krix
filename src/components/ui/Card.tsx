import React from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  variant?: 'light' | 'dark';
}

export function Card({
  className,
  title,
  description,
  children,
  variant = 'light',
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border p-6 shadow-sm',
        variant === 'light'
          ? 'border-gray-200 bg-white'
          : 'border-white/10 bg-white/[0.04] backdrop-blur-sm',
        className
      )}
      {...props}
    >
      {title && (
        <h3
          className={cn(
            'text-lg font-semibold mb-1',
            variant === 'dark' && 'text-white'
          )}
        >
          {title}
        </h3>
      )}
      {description && (
        <p
          className={cn(
            'text-sm mb-4',
            variant === 'dark' ? 'text-neutral-500' : 'text-gray-500'
          )}
        >
          {description}
        </p>
      )}
      {children}
    </div>
  );
}