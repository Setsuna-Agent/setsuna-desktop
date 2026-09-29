import type { BrowserWindow } from 'electron';

type WindowListener = (window: BrowserWindow) => (() => void) | void;

/** Only app-created desktop windows enter this registry; webview guests never do. */
export class DesktopWindowRegistry {
  private readonly entries = new Map<number, { window: BrowserWindow; initialThreadId: string | null }>();
  private readonly listeners = new Set<WindowListener>();

  add(window: BrowserWindow, initialThreadId: string | null = null): void {
    const senderId = window.webContents.id;
    this.entries.set(senderId, { window, initialThreadId });
    window.once('closed', () => {
      this.entries.delete(senderId);
      if (!this.entries.size) this.listeners.clear();
    });
    for (const listener of this.listeners) this.attach(window, listener);
  }

  get(senderId: number): BrowserWindow | null {
    const window = this.entries.get(senderId)?.window;
    return window && !window.isDestroyed() ? window : null;
  }

  all(): BrowserWindow[] {
    return [...this.entries.values()].map(({ window }) => window).filter((window) => !window.isDestroyed());
  }

  initialThreadId(senderId: number): string | null {
    return this.entries.get(senderId)?.initialThreadId ?? null;
  }

  onWindowAdded(listener: WindowListener): () => void {
    const disposers = new Set<() => void>();
    const attach = (window: BrowserWindow) => {
      const dispose = listener(window);
      if (dispose) disposers.add(dispose);
      return () => { if (dispose && disposers.delete(dispose)) dispose(); };
    };
    this.listeners.add(attach);
    for (const window of this.all()) this.attach(window, attach);
    return () => {
      this.listeners.delete(attach);
      for (const dispose of disposers) dispose();
      disposers.clear();
    };
  }

  publish(channel: string, payload: unknown): void {
    for (const window of this.all()) {
      if (!window.webContents.isDestroyed()) window.webContents.send(channel, payload);
    }
  }

  private attach(window: BrowserWindow, listener: WindowListener): void {
    const dispose = listener(window);
    if (dispose) window.once('closed', dispose);
  }
}

export const desktopWindows = new DesktopWindowRegistry();
