export const BROWSER_WEB_STORE_URL = 'https://chromewebstore.google.com/';
export const BROWSER_EXTENSION_ACTION_CHANNEL = 'browser-extension:action';

/** Overrides emitted by the extension itself; omitted fields retain manifest defaults. */
export type BrowserExtensionAction = Readonly<{ id: string; icon?: string; popup?: string; title?: string }>;

/** Trigger bounds in the desktop renderer's viewport CSS pixels. */
export type BrowserExtensionPopupAnchor = Readonly<{ x: number; y: number; width: number; height: number }>;
export type BrowserExtensionView = 'action' | 'popup' | 'options';
export type BrowserExtensionPanel = Readonly<{ id: string; url: string; webContentsId?: number }>;

export type BrowserExtension = Readonly<{
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: readonly string[];
  hostPermissions: readonly string[];
  supportsUserScripts: boolean;
  allowUserScripts: boolean;
  enabled: boolean;
  icon: string | null;
  /** Toolbar artwork declared by action.default_icon, falling back to the app icon. */
  actionIcon: string | null;
  hasPopup: boolean;
  hasOptions: boolean;
  hasAction?: boolean;
  hasSidePanel?: boolean;
  /** Non-null only for the enabled extension currently selected for new tabs. */
  newTabUrl: string | null;
}>;

export type BrowserExtensionInstallFailure = 'invalid-extension' | 'unsupported-manifest' | 'already-installed' | 'installation-pending' | 'load-failed';
export type BrowserExtensionInstallResult =
  | Readonly<{ status: 'installed'; extension: BrowserExtension }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'failed'; reason: BrowserExtensionInstallFailure }>;

export interface BrowserExtensionsBridge {
  getExtensions(): Promise<readonly BrowserExtension[]>;
  installUnpackedExtension(): Promise<BrowserExtensionInstallResult>;
  setExtensionEnabled(id: string, enabled: boolean): Promise<boolean>;
  setExtensionUserScriptsAllowed(id: string, allowed: boolean): Promise<boolean>;
  removeExtension(id: string): Promise<boolean>;
  openExtension(id: string, view: BrowserExtensionView, anchor?: BrowserExtensionPopupAnchor, webContentsId?: number): Promise<boolean>;
  getExtensionPanel(webContentsId?: number): Promise<BrowserExtensionPanel | null>;
  closeExtensionPanel(): Promise<boolean>;
  onExtensionPanelChanged(callback: () => void): () => void;
  getExtensionActions(webContentsId?: number): Promise<readonly BrowserExtensionAction[]>;
  onExtensionActionsChanged(callback: (webContentsId: number | null) => void): () => void;
  onExtensionsChanged(callback: (extensions: readonly BrowserExtension[]) => void): () => void;
}
