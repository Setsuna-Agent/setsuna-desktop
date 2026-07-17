import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function CapabilitiesPluginItemButton({
  description,
  icon,
  meta,
  onClick,
  title,
}: {
  description: string;
  icon: ReactNode;
  meta?: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className="desktop-capabilities-plugin-detail__item"
      aria-label={`查看 ${title} 详情`}
      onClick={onClick}
    >
      <span className="desktop-capabilities-plugin-detail__item-icon">{icon}</span>
      <span className="desktop-capabilities-plugin-detail__item-body">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="desktop-capabilities-plugin-detail__item-trailing">
        {meta}
        <ChevronRight className="desktop-capabilities-plugin-detail__item-chevron" size={15} />
      </span>
    </button>
  );
}
