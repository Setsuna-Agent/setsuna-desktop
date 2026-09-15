import type { HTMLAttributes } from 'react';
import { cn } from './utils.js';

/** Decorative placeholder; the containing surface owns the loading announcement. */
export function Skeleton({ className, ...props }: Omit<HTMLAttributes<HTMLSpanElement>, 'children'>) {
  return <span {...props} className={cn('sd-skeleton', className)} aria-hidden="true" />;
}
