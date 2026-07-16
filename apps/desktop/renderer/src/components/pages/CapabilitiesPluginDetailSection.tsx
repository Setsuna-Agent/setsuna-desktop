import type { ReactNode } from 'react';

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
  return (
    <section className="desktop-capabilities-plugin-detail__section">
      <header>
        <span>{icon}</span>
        <h3>{title}</h3>
        <small>{count}</small>
      </header>
      {count ? <div className="desktop-capabilities-plugin-detail__list">{children}</div> : (
        <p className="desktop-capabilities-plugin-detail__empty">{empty}</p>
      )}
    </section>
  );
}
