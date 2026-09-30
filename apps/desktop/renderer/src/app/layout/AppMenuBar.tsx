import type { DesktopApplicationMenuItem } from '@setsuna-desktop/contracts';
import { Button } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import {
  isKeyboardShortcutCommandId,
  keyboardShortcutCommand,
  type KeyboardShortcutCommandId,
} from '../../shared/shortcuts/keyboardShortcutCommands.js';
import type { AppKeyboardShortcutHandlers } from '../controller/useAppKeyboardShortcuts.js';
import { useToast } from '../providers/ToastProvider.js';
import { AboutDialog } from './AboutDialog.js';

const menuIds = ['file', 'edit', 'view', 'help'] as const;
type MenuId = typeof menuIds[number];
const fileCommands: KeyboardShortcutCommandId[] = ['app.newChat', 'app.addProject', 'app.openSettings'];
const viewCommands: KeyboardShortcutCommandId[] = [
  'layout.toggleSidebar', 'layout.toggleWorkspace', 'layout.toggleTerminal',
  'chat.toggleOverview', 'app.toggleTheme', 'app.toggleRuntimeActivity',
];
const editRoles = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as const;

export function AppMenuBar({ handlers }: { handlers: AppKeyboardShortcutHandlers }) {
  const { t } = useI18n();
  const toast = useToast();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const commandItem = (id: KeyboardShortcutCommandId): DesktopApplicationMenuItem => ({
    type: 'command', id, label: t(keyboardShortcutCommand(id).labelKey),
    enabled: Boolean(handlers[id] && handlers[id]?.enabled !== false),
  });
  const itemsFor = (menuId: MenuId): DesktopApplicationMenuItem[] => {
    if (menuId === 'file') return fileCommands.map(commandItem);
    if (menuId === 'view') return viewCommands.map(commandItem);
    if (menuId === 'help') return [{ type: 'command', id: 'about', label: t('shell.menu.about'), enabled: true }];
    return [
      ...editRoles.flatMap((role): DesktopApplicationMenuItem[] => [
        ...(role === 'cut' || role === 'selectAll' ? [{ type: 'separator' } as const] : []),
        { type: 'edit', role, label: t(`shell.menu.${role}`) },
      ]),
      { type: 'separator' },
      commandItem('chat.find'),
    ];
  };
  const open = async (menuId: MenuId, trigger: HTMLButtonElement) => {
    const controls = window.setsunaDesktop?.windowControls;
    if (!controls || openMenu) return;
    const bounds = trigger.getBoundingClientRect();
    setOpenMenu(menuId);
    try {
      const selected = await controls.showApplicationMenu({ x: bounds.left, y: bounds.bottom, items: itemsFor(menuId) });
      if (selected === 'about') setAboutOpen(true);
      else if (isKeyboardShortcutCommandId(selected)) {
        const handler = handlers[selected];
        if (handler && handler.enabled !== false) handler.execute();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenMenu(null);
    }
  };

  return (
    <>
      <nav className="app-menu-bar" aria-label={t('shell.menu.application')}>
        {menuIds.map((menuId) => (
          <Button key={menuId} variant="ghost" className="app-menu-bar__trigger"
            aria-haspopup="menu" aria-expanded={openMenu === menuId}
            // Preserve the editor's focus and selection for native editing roles.
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => void open(menuId, event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              void open(menuId, event.currentTarget);
            }}
          >{t(`shell.menu.${menuId}`)}</Button>
        ))}
      </nav>
      {aboutOpen ? <AboutDialog onClose={() => setAboutOpen(false)} /> : null}
    </>
  );
}
