export const BROWSER_HOME_URL = 'about:blank';
export const DEFAULT_BROWSER_URL = BROWSER_HOME_URL;

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
