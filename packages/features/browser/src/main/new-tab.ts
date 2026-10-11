import type { HandlerDetails, LoadURLOptions, WebContents } from 'electron';
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

export function navigateEmbeddedBrowserCurrentTab(
  contents: WebContents,
  url: string,
  details?: Pick<HandlerDetails, 'referrer' | 'postBody'>,
): boolean {
  if (contents.isDestroyed() || !isAllowedEmbeddedBrowserUrl(url)) return false;
  const options: LoadURLOptions = { httpReferrer: details?.referrer ?? contents.getURL() };
  const body = details?.postBody;
  // Replaying only the URL would turn target=_blank POST forms into empty GET requests.
  if (body) {
    options.postData = body.data;
    const contentType = body.boundary ? `${body.contentType}; boundary=${body.boundary}` : body.contentType;
    options.extraHeaders = `Content-Type: ${contentType}`;
  }
  // The existing guest reports navigation failures through did-fail-load to BrowserPanel.
  void contents.loadURL(url, options).catch(() => undefined);
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
