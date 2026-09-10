// Adapted from beUI's Button (MIT): https://beui.dev/components/motion/button
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './utils.js';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | 'medium' | 'large';
  icon?: ReactNode;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'secondary', size = 'medium', icon, loading, disabled,
  children, className, type = 'button', ...props
}, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || props['aria-busy']}
      className={cn('sd-button', `sd-button--${variant}`, `sd-button--${size}`, className)}
    >
      {loading ? <span className="sd-spinner" aria-hidden="true" /> : icon ? <span className="sd-button__icon">{icon}</span> : null}
      {children}
    </button>
  );
});

export type IconButtonProps = Omit<ButtonProps, 'variant' | 'children'> & { label: string; children: ReactNode; variant?: 'secondary' | 'ghost' | 'danger' };
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, title = label, className, variant = 'ghost', ...props }, ref) {
  return <Button {...props} ref={ref} aria-label={label} title={title} variant={variant} className={cn('sd-icon-button', className)} />;
});
