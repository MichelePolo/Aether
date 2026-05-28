import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/cn';

const badgeVariants = cva('badge', {
  variants: {
    variant: {
      default: 'bg-zinc-800 text-zinc-400',
      logic: 'bg-disclosure/10 text-disclosure',
      dispatch: 'bg-disclosure/10 text-disclosure',
      validation: 'bg-status-online/10 text-status-online',
      context_fetch: 'bg-zinc-700/40 text-zinc-300',
      mcp_query: 'bg-disclosure/10 text-disclosure',
      thinking: 'bg-disclosure/10 text-disclosure',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...rest }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...rest} />
  ),
);
Badge.displayName = 'Badge';
