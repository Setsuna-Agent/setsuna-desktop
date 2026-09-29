import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './utils.js';

/** Shared static menu surface; positioning, focus and selection belong to the owner. */
export const MenuSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function MenuSurface({
  className, ...props
}, ref) {
  return <div {...props} ref={ref} className={cn('sd-menu-surface', className)} />;
});
