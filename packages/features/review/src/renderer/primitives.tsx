import { Tooltip } from 'antd';
import { type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';

type ReviewIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  variant?: 'secondary' | 'ghost' | 'danger';
};

export function ReviewIconButton({
  label,
  children,
  className = '',
  variant = 'ghost',
  type = 'button',
  ...props
}: ReviewIconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`sd-icon-button sd-icon-button--${variant} ${className}`}
      title={label}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

export function ReviewActionTooltip({
  children,
  placement = 'bottom-end',
  title,
}: Readonly<{
  children: ReactNode;
  placement?: 'bottom-end' | 'top';
  title: string;
}>) {
  return (
    <Tooltip
      arrow={false}
      autoAdjustOverflow
      classNames={{ root: 'sd-tooltip', container: 'sd-tooltip__container' }}
      destroyOnHidden
      mouseEnterDelay={0.18}
      placement={placement === 'bottom-end' ? 'bottomRight' : 'top'}
      title={title}
    >
      <span
        className={`sd-action-tooltip sd-action-tooltip--${placement}`}
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
