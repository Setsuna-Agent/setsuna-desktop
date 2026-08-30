import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

export function PluginDetailSection({
  children,
  count,
  icon,
  title,
}: Readonly<{
  children: ReactNode;
  count: number;
  icon: ReactNode;
  title: string;
}>) {
  const [expanded, setExpanded] = useState(count > 0);
  const contentId = useId();
  if (!count) return null;

  return (
    <section className={`desktop-capabilities-plugin-detail__section${expanded ? ' is-expanded' : ''}`}>
      <header>
        <h3>
          <button
            aria-controls={contentId}
            aria-expanded={expanded}
            className="desktop-capabilities-plugin-detail__section-toggle"
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            <span aria-hidden="true" className="desktop-capabilities-plugin-detail__section-icon">{icon}</span>
            <span className="desktop-capabilities-plugin-detail__section-title">{title}</span>
            <span className="desktop-capabilities-plugin-detail__section-trailing">
              <small>{count}</small>
              <ChevronDown aria-hidden="true" className="desktop-capabilities-plugin-detail__section-chevron" size={15} />
            </span>
          </button>
        </h3>
      </header>
      <div className="desktop-capabilities-plugin-detail__section-content" hidden={!expanded} id={contentId}>
        <div className="desktop-capabilities-plugin-detail__list">{children}</div>
      </div>
    </section>
  );
}

export function PluginDetailItem({
  badges,
  description,
  icon,
  onClick,
  title,
  viewLabel,
}: Readonly<{
  badges?: readonly string[];
  description: string;
  icon: ReactNode;
  onClick?: () => void;
  title: string;
  viewLabel: string;
}>) {
  const content = (
    <>
      {icon}
      <span className="desktop-capabilities-plugin-detail__item-body">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="desktop-capabilities-plugin-detail__item-trailing">
        {badges?.length ? (
          <span className="desktop-capabilities-plugin-detail__item-badges">
            {badges.map((badge) => <span key={badge}>{badge}</span>)}
          </span>
        ) : null}
        {onClick ? <ChevronRight aria-hidden="true" className="desktop-capabilities-plugin-detail__item-chevron" size={15} /> : null}
      </span>
    </>
  );
  return onClick ? (
    <button
      aria-label={viewLabel}
      className="desktop-capabilities-plugin-detail__item"
      type="button"
      onClick={onClick}
    >
      {content}
    </button>
  ) : <div className="desktop-capabilities-plugin-detail__item is-static">{content}</div>;
}

export function PluginDetailItemIcon({
  children,
  kind,
}: Readonly<{
  children: ReactNode;
  kind?: 'mcp';
}>) {
  return (
    <span
      aria-hidden="true"
      className="desktop-capabilities-plugin-detail__item-icon"
      data-kind={kind}
    >
      {children}
    </span>
  );
}
