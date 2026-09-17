import React from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'outline' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  inverse?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: 'bg-black text-white hover:bg-neutral-800',
  outline:
    'border border-neutral-300 text-neutral-900 hover:border-neutral-400 hover:bg-neutral-50',
  ghost: 'text-neutral-700 hover:bg-neutral-100',
};

const inverseVariantClasses: Record<ButtonVariant, string> = {
  default: 'bg-white text-black hover:bg-neutral-200',
  outline:
    'border border-white/25 text-white hover:border-white/50 hover:bg-white/5',
  ghost: 'text-neutral-300 hover:bg-white/10',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-8 py-3.5 text-base',
};

export function Button({
  className,
  variant = 'default',
  size = 'md',
  loading = false,
  inverse = false,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const classes = inverse ? inverseVariantClasses : variantClasses;
  const ringRgb = inverse ? 'focus-visible:ring-white' : 'focus-visible:ring-neutral-900';
  const spinner = inverse
    ? 'border-black/20 border-t-black'
    : 'border-white/30 border-t-white';

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.97]',
        classes[variant],
        sizeClasses[size],
        ringRgb,
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'h-4 w-4 animate-spin rounded-full border-2',
              spinner
            )}
          />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}