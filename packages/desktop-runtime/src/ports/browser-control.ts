import type { DesktopBrowserControlCommand, DesktopBrowserControlResult } from '@setsuna-desktop/contracts';

export type BrowserControlPort = {
  execute(command: DesktopBrowserControlCommand, signal?: AbortSignal): Promise<DesktopBrowserControlResult>;
};

