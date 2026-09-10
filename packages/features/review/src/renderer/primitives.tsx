import { IconButton, Tooltip } from '@setsuna-desktop/renderer-ui';

import { type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';

type ReviewIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  tooltip?: boolean;
  variant?: 'secondary' | 'ghost' | 'danger';
};

export function ReviewIconButton({
  label,
  children,
  className = '',
  tooltip = false,
  title = label,
  variant = 'ghost',
  type = 'button',
  ...props
}: ReviewIconButtonProps) {
  const button = (
    <IconButton variant={variant}
      label={label}
      className={className}
      title={tooltip ? '' : title}
      type={type}
      {...props}
    >
      {children}
    </IconButton>
  );
  return tooltip ? <ReviewActionTooltip title={title}>{button}</ReviewActionTooltip> : button;
}

export function ReviewActionTooltip({
  children,
  disabled = false,
  className = '',
  placement = 'bottom-end',
  title,
}: Readonly<{
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  placement?: 'bottom-end' | 'top';
  title: string;
}>) {
  return (
    <Tooltip
      disabled={disabled}
      mouseEnterDelay={0.18}
      placement={placement === 'bottom-end' ? 'bottomRight' : 'top'}
      title={title}
    >
      <span
        className={`sd-action-tooltip sd-action-tooltip--${placement} ${className}`}
        data-tooltip={title}
      >
        {children as ReactElement}
      </span>
    </Tooltip>
  );
}

export function ReviewEmptyState({ title, body }: Readonly<{
  title: string;
  body?: string;
}>) {
  return (
    <div className="sd-empty-state">
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
    </div>
  );
}
