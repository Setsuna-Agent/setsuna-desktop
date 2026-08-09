import type { ReactNode } from 'react';
import { FolderPlus, MessageSquare, Plus } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { Button } from '../../shared/ui/primitives.js';

export type CapabilitiesCreateMenuItem = {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

export function CapabilitiesCreateMenu({
  busy = false,
  buttonLabel,
  items,
  open,
  onOpenChange,
}: {
  busy?: boolean;
  buttonLabel: string;
  items: CapabilitiesCreateMenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="desktop-capabilities-create">
      <Button
        aria-busy={busy || undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        icon={<Plus size={14} />}
        type="button"
        variant="primary"
        onClick={() => onOpenChange(!open)}
      >
        {buttonLabel}
      </Button>
      {open ? (
        <div className="desktop-capabilities-create-menu" role="menu">
          {items.map((item) => (
            <button
              className="desktop-capabilities-create-menu__item"
              disabled={item.disabled}
              key={item.id}
              role="menuitem"
              type="button"
              onClick={() => {
                onOpenChange(false);
                item.onSelect();
              }}
            >
              <span className="desktop-capabilities-create-menu__icon">{item.icon}</span>
              <span className="desktop-capabilities-create-menu__content">
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CapabilitiesPluginCreateMenu({
  importing,
  open,
  onCreateInConversation,
  onImport,
  onOpenChange,
}: {
  importing: boolean;
  open: boolean;
  onCreateInConversation: () => void;
  onImport: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <CapabilitiesCreateMenu
      busy={importing}
      buttonLabel={t(importing ? 'capabilities.market.installingLocal' : 'capabilities.create.action')}
      items={[
        {
          id: 'chat-plugin',
          title: t('capabilities.create.chatPlugin'),
          description: t('capabilities.create.chatPluginDescription'),
          icon: <MessageSquare size={14} />,
          onSelect: onCreateInConversation,
        },
        {
          id: 'import-plugin',
          title: t('capabilities.create.importPlugin'),
          description: t('capabilities.create.importPluginDescription'),
          icon: <FolderPlus size={14} />,
          disabled: importing,
          onSelect: onImport,
        },
      ]}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}
