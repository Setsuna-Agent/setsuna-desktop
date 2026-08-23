export const DEFAULT_BROWSER_URL = 'https://www.bing.com/';

export type BrowserPanelState = Readonly<{
  faviconUrl: string | null;
  loading: boolean;
  url: string;
}>;

export type BrowserPanelDescriptor = Readonly<{
  browser?: BrowserPanelState;
  id: string;
  title?: string;
}>;

export type BrowserPanelMetadataPatch = Readonly<{
  browser?: BrowserPanelState;
  title?: string;
}>;
