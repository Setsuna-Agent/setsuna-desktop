import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './utils.js';

/** A draggable separator keeps native pointer/keyboard behavior without button surfaces or motion. */
export const ResizeHandle = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>>(function ResizeHandle({
  className, type = 'button', 'aria-orientation': orientation = 'vertical', ...props
}, ref) {
  return <button {...props} ref={ref} type={type} role="separator" aria-orientation={orientation} className={cn('sd-resize-handle', className)} />;
});
