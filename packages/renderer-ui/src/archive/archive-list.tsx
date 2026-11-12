import { Archive } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '../utils.js';

/** Shared archive presentation; each owner keeps its loading, confirmation, and mutation logic. */
export function ArchiveSection({ title, actions, emptyLabel, children }: {
  title: string;
  actions?: ReactNode;
  emptyLabel?: string;
  children?: ReactNode;
}) {
  const titleId = useId();
  return <section className="sd-archive" aria-labelledby={titleId}>
    <header className="sd-archive__header">
      <h2 id={titleId}>{title}</h2>
      {actions}
    </header>
    <div className={cn('sd-archive__surface', emptyLabel && 'sd-archive__surface--empty')}>
      {emptyLabel ? <div className="sd-archive__empty">
        <Archive size={20} aria-hidden="true" /><span>{emptyLabel}</span>
      </div> : children}
    </div>
  </section>;
}

export function ArchiveRow({ title, icon, metadata, actions, className }: {
  title: string;
  icon: ReactNode;
  metadata: ReactNode;
  actions: ReactNode;
  className?: string;
}) {
  return <div className={cn('sd-archive-row', className)} role="group" aria-label={title}>
    <span className="sd-archive-row__icon" aria-hidden="true">{icon}</span>
    <div className="sd-archive-row__copy">
      <strong title={title}>{title}</strong>
      <div className="sd-archive-row__metadata">{metadata}</div>
    </div>
    <div className="sd-archive-row__actions">{actions}</div>
  </div>;
}
