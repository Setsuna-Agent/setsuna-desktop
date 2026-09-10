import { Button as UiButton, Tooltip as AppTooltip } from '@setsuna-desktop/renderer-ui';

import { ArrowLeft } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { useI18n } from '../i18n/I18nProvider.js';
export { SelectField } from './SelectField.js';

export { Button, IconButton, TextField, TextArea, Checkbox } from '@setsuna-desktop/renderer-ui';
export { Tooltip as AppTooltip } from '@setsuna-desktop/renderer-ui';

export function ActionTooltip({ children, placement = 'bottom-end', title }: { children: ReactNode; placement?: 'bottom-end' | 'top'; title: string }) {
  return (
    <AppTooltip placement={placement === 'bottom-end' ? 'bottomRight' : 'top'} title={title}>
      <span className={`sd-action-tooltip sd-action-tooltip--${placement}`} data-tooltip={title}>
        {children}
      </span>
    </AppTooltip>
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

type PageBackButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  block?: boolean;
  icon?: ReactNode;
  label?: ReactNode;
};

export function PageBackButton({
  block = false,
  className = '',
  icon = <ArrowLeft size={14} />,
  label,
  type = 'button',
  ...props
}: PageBackButtonProps) {
  const { t } = useI18n();
  const classes = ['sd-page-back', block ? 'sd-page-back--block' : '', className].filter(Boolean).join(' ');
  return (
    <UiButton variant="ghost" className={classes} type={type} {...props}>
      {icon ? <span className="sd-page-back__icon">{icon}</span> : null}
      <span className="sd-page-back__label">{label ?? t('common.back')}</span>
    </UiButton>
  );
}

export function PageHeader({
  actions,
  backIcon,
  backLabel,
  className = '',
  leading,
  onBack,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  backIcon?: ReactNode;
  backLabel?: string;
  className?: string;
  leading?: ReactNode;
  onBack?: () => void;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className={`sd-page-header ${className}`}>
      {onBack ? (
        <PageBackButton
          className="sd-page-header__back"
          icon={backIcon}
          label={backLabel ?? t('common.back')}
          onClick={onBack}
        />
      ) : null}
      <div className="sd-page-header__body">
        <div className="sd-page-header__main">
          {leading ? <div className="sd-page-header__leading">{leading}</div> : null}
          <div className="sd-page-header__title-group">
            <h2>{title}</h2>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
        </div>
        {actions ? <div className="sd-page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="sd-empty-state">
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function StatusBadge({
  children,
  title,
  tone = 'neutral',
}: {
  children: ReactNode;
  title?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return <span className={`sd-status sd-status--${tone}`} title={title}>{children}</span>;
}
