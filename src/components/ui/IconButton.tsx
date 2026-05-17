import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/cn';

const iconButtonVariants = cva('icon-btn', {
  variants: {
    variant: {
      default: '',
      active: 'bg-zinc-800 text-white',
      danger: 'hover:text-red-400',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, label, children, ...rest }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants({ variant }), className)}
      {...rest}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = 'IconButton';
