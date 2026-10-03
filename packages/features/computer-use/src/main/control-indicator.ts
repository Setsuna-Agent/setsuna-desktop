import { once } from 'node:events';
import { BrowserWindow, screen, type Rectangle } from 'electron';
import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type { ComputerAction, ComputerFrame, ComputerTarget } from '../contracts/index.js';
import { controlIndicatorBorderPage, controlIndicatorStopUrl, controlIndicatorToolbarPage } from './control-indicator-page.js';

type Indicator = { displayId: number; windows: BrowserWindow[]; toolbar?: BrowserWindow; abort: AbortController };

/** The border stays click-through; only the small, movable toolbar accepts input. */
export class ComputerControlIndicator {
  private active: Indicator | undefined;

  constructor(private readonly language: () => RuntimeInterfaceLanguage, private readonly stop: (reason: 'user-stop' | 'indicator-unavailable') => void) {}

  async show(target: ComputerTarget, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const display = target.scope === 'primary-desktop'
      ? screen.getAllDisplays().find((value) => value.id === target.display.id)
      : screen.getDisplayMatching(target.window.bounds);
    if (!display) throw new Error('The controlled display is no longer available.');
    // Keep the user's dragged toolbar position across screenshots and actions.
    if (this.active?.displayId === display.id) return;
    this.hide();
    const current: Indicator = { displayId: display.id, windows: [], abort: new AbortController() };
    this.active = current;
    const cancelled = () => { if (this.active === current) this.hide(); };
    signal.addEventListener('abort', cancelled, { once: true });
    try {
      const language = this.language();
      const width = Math.min(display.workArea.width, language === 'en-US' ? 684 : 584);
      const toolbarBounds = { x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
        y: display.workArea.y + 8, width, height: 76 };
      const border = this.createWindow(current, display.bounds, false);
      const toolbar = this.createWindow(current, toolbarBounds, true);
      current.toolbar = toolbar;
      const loading = AbortSignal.any([signal, current.abort.signal]);
      await Promise.all([
        this.load(border, controlIndicatorBorderPage(), loading),
        this.load(toolbar, controlIndicatorToolbarPage(language, process.platform), loading),
      ]);
      loading.throwIfAborted();
      if (this.active !== current) throw new Error('Computer control indicator closed.');
      // Screen bounds are DIP, independent of screenshot/input pixel coordinates.
      border.setBounds(display.bounds);
      border.showInactive();
      toolbar.showInactive();
    } catch (error) {
      if (this.active === current) this.hide();
      throw error;
    } finally {
      signal.removeEventListener('abort', cancelled);
    }
  }

  prepareInput(action: ComputerAction, frame: ComputerFrame): void {
    // macOS targets a window directly; only desktop input can hit our overlay.
    if (frame.scope !== 'primary-desktop' || !('x' in action)) return;
    const toolbar = this.active?.toolbar;
    if (!toolbar || toolbar.isDestroyed()) throw new Error('Computer control indicator is unavailable.');
    const display = screen.getAllDisplays().find((value) => value.id === frame.display.id);
    if (!display) throw new Error('The controlled display is no longer available.');
    // Match the native backend's screenshot-to-physical-pixel mapping, including
    // rounding. Read live bounds because the user can drag the toolbar at any time.
    const x = frame.display.inputBounds.x + Math.floor(action.x * frame.display.inputBounds.width / frame.width);
    const y = frame.display.inputBounds.y + Math.floor(action.y * frame.display.inputBounds.height / frame.height);
    const blocksInput = () => containsPoint(screen.dipToScreenRect(null, toolbar.getBounds()), x, y);
    if (!blocksInput()) return;
    const bounds = toolbar.getBounds();
    const area = display.workArea;
    const left = Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width));
    // Move out of the click path instead of disabling the user's stop button.
    for (const top of [area.y + 8, area.y + area.height - bounds.height - 8]) {
      toolbar.setBounds({ ...bounds, x: left, y: top });
      if (!blocksInput()) return;
    }
    throw new Error('The control toolbar could not move clear of the input target. No input was dispatched.');
  }

  private createWindow(current: Indicator, bounds: Rectangle, interactive: boolean): BrowserWindow {
    const window = new BrowserWindow({
      ...bounds,
      title: 'Setsuna Computer Control',
      show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      focusable: false, skipTaskbar: true, resizable: false, movable: interactive,
      minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
      roundedCorners: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, devTools: false },
    });
    current.windows.push(window);
    const failed = () => {
      if (this.active !== current) return;
      this.hide();
      this.stop('indicator-unavailable');
    };
    window.once('closed', failed);
    window.on('hide', failed);
    window.on('unresponsive', failed);
    window.webContents.on('render-process-gone', failed);
    window.webContents.on('will-navigate', (event) => {
      event.preventDefault();
      // This window owns one fixed action, with no global IPC or URL arguments.
      if (interactive && this.active === current && event.url === controlIndicatorStopUrl) this.stop('user-stop');
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.setMenu(null);
    window.setIgnoreMouseEvents(!interactive);
    // Exclude both layers before their first desktop composition. macOS still
    // captures only the selected target window, not these auxiliary windows.
    window.setContentProtection(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.setHiddenInMissionControl(true);
    }
    return window;
  }

  private async load(window: BrowserWindow, url: string, signal: AbortSignal): Promise<void> {
    // Closing either layer aborts both first-paint waits; a late load cannot show
    // either window after the session has stopped.
    const ready = once(window, 'ready-to-show', { signal });
    await Promise.all([ready, window.loadURL(url)]);
  }

  hide(): void {
    const current = this.active;
    this.active = undefined;
    current?.abort.abort(new Error('Computer control indicator closed.'));
    for (const window of current?.windows ?? []) if (!window.isDestroyed()) window.destroy();
  }
}

function containsPoint(bounds: Rectangle, x: number, y: number): boolean {
  return x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
}
