import { ArrowLeft } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
export { SelectField } from './SelectField.js';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className = '', variant = 'secondary', icon, children, type = 'button', ...props }, ref) {
  return (
    <button ref={ref} className={`sd-button sd-button--${variant} ${className}`} type={type} {...props}>
      {icon ? <span className="sd-button__icon">{icon}</span> : null}
      {children ? <span className="sd-button__label">{children}</span> : null}
    </button>
  );
});

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  variant?: 'secondary' | 'ghost' | 'danger';
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, children, className = '', variant = 'ghost', type = 'button', ...props }, ref) {
  return (
    <button ref={ref} aria-label={label} title={label} className={`sd-icon-button sd-icon-button--${variant} ${className}`} type={type} {...props}>
      {children}
    </button>
  );
});

export function ActionTooltip({ children, title }: { children: ReactNode; title: string }) {
  return (
    <span className="sd-action-tooltip" data-tooltip={title}>
      {children}
    </span>
  );
}

export function TextField({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`sd-field ${className}`} {...props} />;
}

export function TextArea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`sd-textarea ${className}`} {...props} />;
}

export function Panel({ title, meta, actions, children, className = '' }: { title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`sd-panel ${className}`}>
      <header className="sd-panel__header">
        <div className="sd-panel__title-group">
          <h2>{title}</h2>
          {meta ? <div className="sd-panel__meta">{meta}</div> : null}
        </div>
        {actions ? <div className="sd-panel__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

type PageBackButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  block?: boolean;
  icon?: ReactNode;
  label?: ReactNode;
};

export function PageBackButton({
  block = false,
  className = '',
  icon = <ArrowLeft size={14} />,
  label = '返回',
  type = 'button',
  ...props
}: PageBackButtonProps) {
  const classes = ['sd-page-back', block ? 'sd-page-back--block' : '', className].filter(Boolean).join(' ');
  return (
    <button className={classes} type={type} {...props}>
      {icon ? <span className="sd-page-back__icon">{icon}</span> : null}
      <span className="sd-page-back__label">{label}</span>
    </button>
  );
}

export function PageHeader({
  actions,
  backIcon,
  backLabel = '返回',
  className = '',
  onBack,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  backIcon?: ReactNode;
  backLabel?: string;
  className?: string;
  onBack?: () => void;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header className={`sd-page-header ${className}`}>
      {onBack ? (
        <PageBackButton className="sd-page-header__back" icon={backIcon} label={backLabel} onClick={onBack} />
      ) : null}
      <div className="sd-page-header__body">
        <div className="sd-page-header__title-group">
          <h2>{title}</h2>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        {actions ? <div className="sd-page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="sd-empty-state">
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
    </div>
  );
}

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={`sd-status sd-status--${tone}`}>{children}</span>;
}
