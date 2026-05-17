import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/cn';

const badgeVariants = cva('badge', {
  variants: {
    variant: {
      default: 'bg-zinc-800 text-zinc-400',
      logic: 'bg-blue-500/10 text-blue-400',
      dispatch: 'bg-purple-500/10 text-purple-400',
      validation: 'bg-green-500/10 text-green-400',
      context_fetch: 'bg-zinc-700/40 text-zinc-300',
      mcp_query: 'bg-cyan-500/10 text-cyan-400',
      thinking: 'bg-amber-500/10 text-amber-400',
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
