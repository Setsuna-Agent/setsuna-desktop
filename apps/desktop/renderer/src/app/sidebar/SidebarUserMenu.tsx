import { Settings } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';

export function SidebarUserMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n();

  return (
    <div className="chat-sidebar-user">
      <ShortcutTooltip commandId="app.openSettings" label={t('sidebar.openSettings')} placement="top">
        <button
          className="chat-sidebar-user__trigger"
          type="button"
          aria-label={t('sidebar.openSettings')}
          onClick={onOpenSettings}
        >
          <Settings className="chat-sidebar-user__icon" size={15} />
          <span className="chat-sidebar-user__name">{t('settings.title')}</span>
        </button>
      </ShortcutTooltip>
    </div>
  );
}
