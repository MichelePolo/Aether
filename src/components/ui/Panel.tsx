import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/src/lib/cn';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'inset';
  title?: string;
  children: ReactNode;
}

export function Panel({ variant = 'default', title, className, children, ...rest }: PanelProps) {
  return (
    <div
      className={cn(variant === 'inset' ? 'panel-inset' : 'panel', 'p-3', className)}
      {...rest}
    >
      {title && <div className="mono-label mb-2">{title}</div>}
      {children}
    </div>
  );
}
