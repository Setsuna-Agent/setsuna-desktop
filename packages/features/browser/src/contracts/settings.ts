export const BROWSER_SETTINGS_CHANNELS = {
  get: 'browser:settings:get', update: 'browser:settings:update', changed: 'browser:settings:changed',
  clearData: 'browser:settings:clear-data', chooseDownloadDirectory: 'browser:settings:download-directory',
  listPasswords: 'browser:settings:passwords', savePassword: 'browser:settings:save-password',
  deletePassword: 'browser:settings:delete-password',
} as const;

export const BROWSER_PERMISSIONS = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard'] as const;
export type BrowserPermission = typeof BROWSER_PERMISSIONS[number];
export type BrowserPermissionPolicy = 'ask' | 'allow' | 'block';
export type BrowserSearchEngine = 'bing' | 'google' | 'baidu' | 'duckduckgo';
export type BrowserPreferences = Readonly<{
  searchEngine: BrowserSearchEngine;
  homeUrl: string;
  showHomeButton: boolean;
  showFullUrl: boolean;
  defaultZoom: number;
  rememberHistory: boolean;
  savePasswords: boolean;
  autofillPasswords: boolean;
  useExtensionNewTab: boolean;
  agentControl: boolean;
  spellcheck: boolean;
  askDownloadLocation: boolean;
  downloadDirectory: string;
  permissions: Readonly<Record<BrowserPermission, BrowserPermissionPolicy>>;
  sitePermissions: Readonly<Record<string, Partial<Record<BrowserPermission, BrowserPermissionPolicy>>>>;
}>;
export type BrowserPreferencesPatch = Partial<Omit<BrowserPreferences, 'downloadDirectory' | 'permissions'>> & {
  permissions?: Partial<BrowserPreferences['permissions']>;
};
export const DEFAULT_BROWSER_PREFERENCES: BrowserPreferences = {
  searchEngine: 'bing', homeUrl: '', showHomeButton: true, showFullUrl: true, defaultZoom: 1,
  rememberHistory: true, savePasswords: true, autofillPasswords: true, useExtensionNewTab: true,
  agentControl: true, spellcheck: true, askDownloadLocation: true, downloadDirectory: '',
  permissions: { camera: 'block', microphone: 'block', geolocation: 'block', notifications: 'block', clipboard: 'block' },
  sitePermissions: {},
};
export type BrowserClearData = Readonly<{ cache?: boolean; cookies?: boolean; siteStorage?: boolean; passwords?: boolean }>;
export type BrowserSavedPassword = Readonly<{ id: string; origin: string; username: string }>;
export interface BrowserSettingsBridge {
  getBrowserPreferences(): Promise<BrowserPreferences>;
  updateBrowserPreferences(patch: BrowserPreferencesPatch): Promise<BrowserPreferences>;
  onBrowserPreferencesChanged(callback: (preferences: BrowserPreferences) => void): () => void;
  clearBrowserData(selection: BrowserClearData): Promise<void>;
  chooseBrowserDownloadDirectory(): Promise<BrowserPreferences>;
  listBrowserPasswords(): Promise<BrowserSavedPassword[]>;
  saveBrowserPassword(input: { origin: string; username: string; password: string }): Promise<void>;
  deleteBrowserPassword(origin: string, id: string): Promise<void>;
}
