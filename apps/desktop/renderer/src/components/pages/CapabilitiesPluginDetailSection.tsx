import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function CapabilitiesPluginDetailSection({
  children,
  count,
  empty,
  icon,
  title,
}: {
  children: ReactNode;
  count: number;
  empty: string;
  icon: ReactNode;
  title: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();

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
        {count ? <div className="desktop-capabilities-plugin-detail__list">{children}</div> : (
          <p className="desktop-capabilities-plugin-detail__empty">{empty}</p>
        )}
      </div>
    </section>
  );
}
