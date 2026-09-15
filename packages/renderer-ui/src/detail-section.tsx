import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Button } from './button.js';

/** Collapsible reading section shared by capability details and repository workbenches. */
export function DetailSection({ title, icon, count, children, defaultExpanded = true, className = '' }: {
  title: ReactNode; icon?: ReactNode; count?: ReactNode; children: ReactNode; defaultExpanded?: boolean; className?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();
  return <section className={`sd-detail-section${expanded ? ' is-expanded' : ''} ${className}`}>
    <header><h3><Button variant="ghost" aria-controls={contentId} aria-expanded={expanded} className="sd-detail-section-toggle" onClick={() => setExpanded((current) => !current)}>
      <span aria-hidden="true" className="sd-detail-section-icon">{icon}</span>
      <span className="sd-detail-section-title">{title}</span>
      <span className="sd-detail-section-trailing"><small>{count}</small><ChevronDown aria-hidden="true" className="sd-detail-section-chevron" size={15} /></span>
    </Button></h3></header>
    <div className="sd-detail-section-content" hidden={!expanded} id={contentId}>{children}</div>
  </section>;
}
