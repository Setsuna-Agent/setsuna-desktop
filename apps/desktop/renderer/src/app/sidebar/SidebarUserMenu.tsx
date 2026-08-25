import { MoreHorizontal, Settings } from 'lucide-react';
import { useCallback, useState, type RefObject } from 'react';
import { RuntimeActivityMenuItem } from '../../features/runtime-activity/RuntimeActivityMenuItem.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import { SidebarFloatingMenu } from './SidebarFloatingMenu.js';

export function SidebarUserMenu({
  runtimeActivityTriggerRef,
  onOpenRuntimeActivity,
  onOpenSettings,
}: {
  runtimeActivityTriggerRef: RefObject<HTMLButtonElement>;
  onOpenRuntimeActivity: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className={`chat-sidebar-user ${menuOpen ? 'is-menu-open' : ''}`}>
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
      <button
        ref={runtimeActivityTriggerRef}
        className={`chat-sidebar-user__more ${menuOpen ? 'is-active' : ''}`}
        type="button"
        aria-label={t('sidebar.moreActions')}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={15} />
      </button>
      <SidebarFloatingMenu
        open={menuOpen}
        placement="top-left"
        triggerRef={runtimeActivityTriggerRef}
        onClose={closeMenu}
      >
        <RuntimeActivityMenuItem
          onClick={() => {
            closeMenu();
            onOpenRuntimeActivity();
          }}
        />
      </SidebarFloatingMenu>
    </div>
  );
}
