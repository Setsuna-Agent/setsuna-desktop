import { Button } from '@setsuna-desktop/renderer-ui';
import { shellSidebarAvatarSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { Info, Keyboard, Moon, Sun } from 'lucide-react';
import { lazy, Suspense, useCallback, useState, type RefObject } from 'react';
import appIcon from '../../../../../../assets/build/icon.png';
import { RuntimeActivityFeatureMenuItem } from '../../composition/RuntimeActivityFeatureBoundary.js';
import { RendererOwnedSingleSlot } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { useResolvedThemeMode, useThemeTransition } from '../../shared/preferences/useThemeTransition.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import { AppTooltip } from '../../shared/ui/primitives.js';
import { AboutDialog } from '../layout/AboutDialog.js';
import { AppNavigationIcon } from '../layout/AppNavigationIcon.js';
import { SidebarFloatingMenu } from './SidebarFloatingMenu.js';

const KeyboardShortcutsDialog = lazy(async () => ({
  default: (await import('../layout/KeyboardShortcutsDialog.js')).KeyboardShortcutsDialog,
}));

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
  const [activeDialog, setActiveDialog] = useState<'about' | 'shortcuts' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openDialog = (dialog: 'about' | 'shortcuts') => {
    closeMenu();
    // Restore the dialog to a persistent trigger rather than its unmounted menu item.
    runtimeActivityTriggerRef.current?.focus();
    setActiveDialog(dialog);
  };

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
          <AppNavigationIcon name="settings" active={settingsActive} />
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
          <span className="app-navigation__avatar">
            <RendererOwnedSingleSlot
              slot={shellSidebarAvatarSlot}
              props={{ renderDefault: () => <img className="app-navigation__logo" src={appIcon} alt="" width={28} height={28} draggable={false} /> }}
            />
          </span>
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
        <Button variant="ghost" type="button" role="menuitem" onClick={() => openDialog('shortcuts')}>
          <Keyboard size={13} />
          {t('settings.section.shortcuts')}
        </Button>
        <Button variant="ghost" type="button" role="menuitem" onClick={() => openDialog('about')}>
          <Info size={13} />
          {t('shell.menu.about')}
        </Button>
      </SidebarFloatingMenu>
      {activeDialog === 'about' ? <AboutDialog onClose={() => setActiveDialog(null)} /> : null}
      {activeDialog === 'shortcuts' ? <Suspense fallback={null}>
        <KeyboardShortcutsDialog onClose={() => setActiveDialog(null)} />
      </Suspense> : null}
    </div>
  );
}
