type EmbeddedBrowserTabHost = {
  isDestroyed(): boolean;
  send(channel: 'browser:open-new-tab', payload: EmbeddedBrowserTabRequest): void;
};

type EmbeddedBrowserTabRequest = {
  openerWebContentsId: number;
  url: string;
};

export function requestEmbeddedBrowserNewTab(
  hostWebContents: EmbeddedBrowserTabHost | null,
  openerWebContentsId: number,
  url: string,
): boolean {
  if (!isAllowedEmbeddedBrowserUrl(url) || !hostWebContents || hostWebContents.isDestroyed()) {
    return false;
  }
  hostWebContents.send('browser:open-new-tab', { openerWebContentsId, url });
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
