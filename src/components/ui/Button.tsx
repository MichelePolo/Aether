import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/cn';
import { focusRing } from './focus';

const buttonVariants = cva(
  `inline-flex items-center justify-center font-mono rounded transition-colors disabled:opacity-30 disabled:pointer-events-none ${focusRing}`,
  {
    variants: {
      variant: {
        primary: 'bg-accent text-black hover:bg-accent/90',
        ghost: 'bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-white',
        danger: 'bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white',
      },
      size: {
        sm: 'text-[10px] px-2 py-1 gap-1',
        md: 'text-xs px-3 py-1.5 gap-2',
        lg: 'text-sm px-4 py-2 gap-2',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...rest }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...rest} />
  ),
);
Button.displayName = 'Button';
