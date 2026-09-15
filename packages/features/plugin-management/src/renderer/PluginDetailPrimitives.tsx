import { Button, DetailSection } from '@setsuna-desktop/renderer-ui';
import { ChevronRight, Github } from 'lucide-react';
import { type ReactNode } from 'react';

export function PluginRepositoryLink({ children, className = '', onClick }: Readonly<{
  children: ReactNode;
  className?: string;
  onClick(): void;
}>) {
  return (
    <Button variant="ghost" className={`desktop-plugin-repository-link ${className}`} onClick={onClick}>
      <Github aria-hidden="true" size={14} />
      <span>{children}</span>
    </Button>
  );
}

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
  if (!count) return null;
  return <DetailSection title={title} icon={icon} count={count}>
    <div className="desktop-capabilities-plugin-detail__list">{children}</div>
  </DetailSection>;
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
    <Button variant="ghost"
      aria-label={viewLabel}
      className="desktop-capabilities-plugin-detail__item"
      type="button"
      onClick={onClick}
    >
      {content}
    </Button>
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
