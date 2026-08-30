import type { BrowserWindow } from 'electron';

type OpenExternal = (url: string) => Promise<unknown>;

/** Keeps the privileged renderer in its BrowserWindow and delegates safe links to the OS. */
export function registerMainWindowNavigationGuards(
  window: BrowserWindow,
  openExternal: OpenExternal,
): void {
  const openSupportedExternalUrl = (url: string) => {
    if (!isSupportedExternalUrl(url)) return;
    void openExternal(url).catch((error: unknown) => {
      console.error('[window] failed to open external URL', error);
    });
  };

  window.webContents.setWindowOpenHandler(({ url }) => {
    openSupportedExternalUrl(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererNavigation(window.webContents.getURL(), url)) return;
    event.preventDefault();
    openSupportedExternalUrl(url);
  });
}

export function isSupportedExternalUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function isTrustedRendererNavigation(currentUrl: string, targetUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    if (current.protocol === 'http:' || current.protocol === 'https:') {
      return target.origin === current.origin;
    }
    if (current.protocol !== 'file:' || target.protocol !== 'file:') return false;
    current.hash = '';
    target.hash = '';
    return target.href === current.href;
  } catch {
    return false;
  }
}
