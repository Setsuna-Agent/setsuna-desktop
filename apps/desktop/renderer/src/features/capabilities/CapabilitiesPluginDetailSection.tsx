import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

export function CapabilitiesPluginDetailSection({
  children,
  count,
  icon,
  title,
}: {
  children: ReactNode;
  count: number;
  icon: ReactNode;
  title: string;
}) {
  const [expanded, setExpanded] = useState(count > 0);
  const contentId = useId();

  if (count === 0) return null;

  return (
    <section className={`desktop-capabilities-plugin-detail__section${expanded ? ' is-expanded' : ''}`}>
      <header>
        <h3>
          <button
            type="button"
            className="desktop-capabilities-plugin-detail__section-toggle"
            aria-controls={contentId}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="desktop-capabilities-plugin-detail__section-icon" aria-hidden="true">{icon}</span>
            <span className="desktop-capabilities-plugin-detail__section-title">{title}</span>
            <span className="desktop-capabilities-plugin-detail__section-trailing">
              <small>{count}</small>
              <ChevronDown className="desktop-capabilities-plugin-detail__section-chevron" size={15} aria-hidden="true" />
            </span>
          </button>
        </h3>
      </header>
      <div className="desktop-capabilities-plugin-detail__section-content" id={contentId} hidden={!expanded}>
        <div className="desktop-capabilities-plugin-detail__list">{children}</div>
      </div>
    </section>
  );
}
