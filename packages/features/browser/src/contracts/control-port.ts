import type { DesktopBrowserControlCommand, DesktopBrowserControlResult } from './browser-control.js';

export type BrowserControlPort = {
  execute(command: DesktopBrowserControlCommand, signal?: AbortSignal): Promise<DesktopBrowserControlResult>;
};

