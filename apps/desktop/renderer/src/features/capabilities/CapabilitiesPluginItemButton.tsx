import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function CapabilitiesPluginItemButton({
  badges,
  description,
  icon,
  onClick,
  title,
}: {
  badges?: string[];
  description: string;
  icon: ReactNode;
  onClick?: () => void;
  title: string;
}) {
  const { t } = useI18n();
  const content = (
    <>
      <span className="desktop-capabilities-plugin-detail__item-icon">{icon}</span>
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
        {onClick ? <ChevronRight className="desktop-capabilities-plugin-detail__item-chevron" size={15} /> : null}
      </span>
    </>
  );
  if (!onClick) return <div className="desktop-capabilities-plugin-detail__item is-static">{content}</div>;
  return (
    <button
      type="button"
      className="desktop-capabilities-plugin-detail__item"
      aria-label={t('capabilities.detail.viewItem', { title })}
      onClick={onClick}
    >
      {content}
    </button>
  );
}
