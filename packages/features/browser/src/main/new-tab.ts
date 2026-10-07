import type { BrowserOpenNewTabRequest } from '../contracts/bridge.js';

type EmbeddedBrowserTabHost = {
  isDestroyed(): boolean;
  send(channel: 'browser:open-new-tab', payload: BrowserOpenNewTabRequest): void;
};

export function requestEmbeddedBrowserNewTab(
  hostWebContents: EmbeddedBrowserTabHost | null,
  openerWebContentsId: number,
  url: string,
  tabId?: string,
): boolean {
  if (!isAllowedEmbeddedBrowserUrl(url) || !hostWebContents || hostWebContents.isDestroyed()) {
    return false;
  }
  hostWebContents.send('browser:open-new-tab', { openerWebContentsId, url, ...(tabId ? { tabId } : {}) });
  return true;
}

export function isAllowedEmbeddedBrowserUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:'
      || url.protocol === 'https:'
      || (url.protocol === 'about:' && url.href === 'about:blank');
  } catch {
    return false;
  }
}
