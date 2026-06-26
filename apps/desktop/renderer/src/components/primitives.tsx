import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: ReactNode;
};

export function Button({ className = '', variant = 'secondary', icon, children, ...props }: ButtonProps) {
  return (
    <button className={`sd-button sd-button--${variant} ${className}`} {...props}>
      {icon ? <span className="sd-button__icon">{icon}</span> : null}
      {children ? <span className="sd-button__label">{children}</span> : null}
    </button>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  variant?: 'secondary' | 'ghost' | 'danger';
};

export function IconButton({ label, children, className = '', variant = 'ghost', ...props }: IconButtonProps) {
  return (
    <button aria-label={label} title={label} className={`sd-icon-button sd-icon-button--${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function TextField({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`sd-field ${className}`} {...props} />;
}

export function TextArea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`sd-textarea ${className}`} {...props} />;
}

export function SelectField({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`sd-field sd-select ${className}`} {...props}>
      {children}
    </select>
  );
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

