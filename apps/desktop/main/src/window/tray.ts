import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type {
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
  NativeImage,
  Tray,
} from 'electron';
import { createNativeTranslate } from '../i18n/native-messages.js';

interface DesktopTrayControllerOptions {
  buildMenu(template: MenuItemConstructorOptions[]): Menu;
  createTray(icon: NativeImage): Tray;
  getInterfaceLanguage(): RuntimeInterfaceLanguage;
  icon?: NativeImage;
  onOpen(): void;
  onQuit(): void;
}

export class DesktopTrayController {
  private tray: Tray | null = null;

  constructor(private readonly options: DesktopTrayControllerOptions) {}

  setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.dispose();
      return;
    }
    if (this.tray) return;
    if (!this.options.icon || this.options.icon.isEmpty()) {
      throw new Error('The system tray icon is unavailable.');
    }

    const tray = this.options.createTray(this.options.icon);
    try {
      tray.setToolTip('Setsuna Desktop');
      tray.on('click', this.handleClick);
      this.tray = tray;
      this.refreshMenu();
    } catch (error) {
      tray.removeListener('click', this.handleClick);
      tray.destroy();
      this.tray = null;
      throw error;
    }
  }

  refreshMenu(): void {
    if (!this.tray) return;
    const t = createNativeTranslate(this.options.getInterfaceLanguage());
    this.tray.setContextMenu(this.options.buildMenu([
      { label: t('tray.open'), click: this.options.onOpen },
      { type: 'separator' },
      { label: t('tray.quit'), click: this.options.onQuit },
    ]));
  }

  dispose(): void {
    if (!this.tray) return;
    this.tray.removeListener('click', this.handleClick);
    this.tray.destroy();
    this.tray = null;
  }

  private readonly handleClick = () => {
    this.options.onOpen();
  };
}

export function revealDesktopWindow(
  window: Pick<BrowserWindow, 'focus' | 'isDestroyed' | 'isMinimized' | 'restore' | 'show'>,
): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
