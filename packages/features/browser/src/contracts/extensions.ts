export const BROWSER_WEB_STORE_URL = 'https://chromewebstore.google.com/';
export const BROWSER_EXTENSION_ACTION_CHANNEL = 'browser-extension:action';

/** Overrides emitted by the extension itself; omitted fields retain manifest defaults. */
export type BrowserExtensionAction = Readonly<{ id: string; icon?: string; popup?: string; title?: string }>;

/** Trigger bounds in the desktop renderer's viewport CSS pixels. */
export type BrowserExtensionPopupAnchor = Readonly<{ x: number; y: number; width: number; height: number }>;

export type BrowserExtension = Readonly<{
  id: string;
  name: string;
  version: string;
  icon: string | null;
  /** Toolbar artwork declared by action.default_icon, falling back to the app icon. */
  actionIcon: string | null;
  hasPopup: boolean;
  hasOptions: boolean;
  /** Non-null only for the installed extension currently selected for new tabs. */
  newTabUrl: string | null;
}>;

export interface BrowserExtensionsBridge {
  getExtensions(): Promise<readonly BrowserExtension[]>;
  removeExtension(id: string): Promise<boolean>;
  openExtension(id: string, view: 'popup' | 'options', anchor?: BrowserExtensionPopupAnchor, webContentsId?: number): Promise<boolean>;
  getExtensionActions(webContentsId?: number): Promise<readonly BrowserExtensionAction[]>;
  onExtensionActionsChanged(callback: (webContentsId: number | null) => void): () => void;
  onExtensionsChanged(callback: (extensions: readonly BrowserExtension[]) => void): () => void;
}
