import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/cn';

const dotVariants = cva('status-dot', {
  variants: {
    status: {
      online: 'bg-status-online shadow-[0_0_8px_var(--color-status-online)]',
      offline: 'bg-status-offline',
      connecting: 'bg-status-connecting animate-pulse',
      error: 'bg-status-error',
    },
  },
});

export interface StatusDotProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'title'>,
    Required<VariantProps<typeof dotVariants>> {
  label: string;
}

export function StatusDot({ status, label, className, ...rest }: StatusDotProps) {
  return (
    <span
      title={`${label}: ${status}`}
      className={cn(dotVariants({ status }), className)}
      {...rest}
    />
  );
}
