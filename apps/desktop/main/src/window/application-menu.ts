import type { DesktopApplicationMenuInput } from '@setsuna-desktop/contracts';
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

const editRoles = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);

export function isApplicationMenuInput(value: unknown): value is DesktopApplicationMenuInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<DesktopApplicationMenuInput>;
  return typeof input.x === 'number' && Number.isFinite(input.x)
    && typeof input.y === 'number' && Number.isFinite(input.y)
    && Array.isArray(input.items) && input.items.length > 0 && input.items.length <= 40
    && input.items.every((item) => {
      if (!item || typeof item !== 'object') return false;
      if (item.type === 'separator') return true;
      if (typeof item.label !== 'string' || item.label.length > 200) return false;
      if (item.type === 'edit') return editRoles.has(item.role);
      return item.type === 'command' && typeof item.id === 'string' && item.id.length <= 100
        && typeof item.enabled === 'boolean';
    });
}

export function showApplicationMenu(window: BrowserWindow, input: unknown): Promise<string | null> {
  if (!isApplicationMenuInput(input) || window.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let selected: string | null = null;
    const template = input.items.map((item): MenuItemConstructorOptions => {
      if (item.type === 'separator') return { type: 'separator' };
      // Only editing roles run in main. App commands return to the requesting
      // renderer, where the active conversation and enabled state are owned.
      if (item.type === 'edit') return { role: item.role, label: item.label };
      return { label: item.label, enabled: item.enabled, click: () => { selected = item.id; } };
    });
    const menu = Menu.buildFromTemplate(template);
    const zoom = window.webContents.getZoomFactor();
    const finish = () => {
      window.off('closed', finish);
      resolve(selected);
    };
    window.once('closed', finish);
    menu.popup({
      window,
      x: Math.max(0, Math.round(input.x * zoom)),
      y: Math.max(0, Math.round(input.y * zoom)),
      callback: finish,
    });
  });
}
