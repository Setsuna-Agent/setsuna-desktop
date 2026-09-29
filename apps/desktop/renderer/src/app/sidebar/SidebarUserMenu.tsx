import { Button } from '@setsuna-desktop/renderer-ui';
import { Info, Moon, MoreHorizontal, Settings, Sun } from 'lucide-react';
import { useCallback, useState, type RefObject } from 'react';
import { RuntimeActivityFeatureMenuItem } from '../../composition/RuntimeActivityFeatureBoundary.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { useResolvedThemeMode, useThemeTransition } from '../../shared/preferences/useThemeTransition.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import { AppTooltip } from '../../shared/ui/primitives.js';
import { AboutDialog } from '../layout/AboutDialog.js';
import { SidebarFloatingMenu } from './SidebarFloatingMenu.js';

export function SidebarUserMenu({
  settingsActive,
  runtimeActivityTriggerRef,
  themeToggleTriggerRef,
  onOpenRuntimeActivity,
  onOpenSettings,
}: {
  settingsActive: boolean;
  runtimeActivityTriggerRef: RefObject<HTMLButtonElement>;
  themeToggleTriggerRef: RefObject<HTMLButtonElement>;
  onOpenRuntimeActivity: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const { toggleWithTransition } = useThemeTransition();
  const resolvedTheme = useResolvedThemeMode();
  const themeToggleLabel = t(resolvedTheme === 'dark' ? 'sidebar.switchToLightTheme' : 'sidebar.switchToDarkTheme');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className="app-navigation__footer">
      <ShortcutTooltip commandId="app.toggleTheme" label={themeToggleLabel} placement="right">
        <Button
          ref={themeToggleTriggerRef}
          variant="ghost"
          className="app-navigation__button"
          type="button"
          aria-label={themeToggleLabel}
          onClick={toggleWithTransition}
        >
          {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
      </ShortcutTooltip>
      <ShortcutTooltip commandId="app.openSettings" label={t('sidebar.openSettings')} placement="right">
        <Button variant="ghost"
          className={`app-navigation__button${settingsActive ? ' is-active' : ''}`}
          type="button"
          aria-label={t('sidebar.openSettings')}
          aria-current={settingsActive ? 'page' : undefined}
          onClick={onOpenSettings}
        >
          <Settings size={18} />
        </Button>
      </ShortcutTooltip>
      <AppTooltip title={t('sidebar.moreActions')} placement="right">
        <Button variant="ghost"
          ref={runtimeActivityTriggerRef}
          className={`app-navigation__button${menuOpen ? ' is-active' : ''}`}
          type="button"
          aria-label={t('sidebar.moreActions')}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={18} />
        </Button>
      </AppTooltip>
      <SidebarFloatingMenu
        open={menuOpen}
        placement="top-left"
        triggerRef={runtimeActivityTriggerRef}
        onClose={closeMenu}
      >
        <RuntimeActivityFeatureMenuItem
          onClick={() => {
            closeMenu();
            onOpenRuntimeActivity();
          }}
        />
        <Button variant="ghost" type="button" role="menuitem" onClick={() => {
          closeMenu();
          // Restore the dialog to a persistent trigger rather than its unmounted menu item.
          runtimeActivityTriggerRef.current?.focus();
          setAboutOpen(true);
        }}>
          <Info size={13} />
          {t('shell.menu.about')}
        </Button>
      </SidebarFloatingMenu>
      {aboutOpen ? <AboutDialog onClose={() => setAboutOpen(false)} /> : null}
    </div>
  );
}
