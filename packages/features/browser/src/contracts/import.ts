import type { BrowserBookmarkTree } from './bookmarks.js';

export const BROWSER_IMPORT_CHANNELS = Object.freeze({
  profiles: 'browser:import-profiles',
  preview: 'browser:import-preview',
  extensions: 'browser:import-extensions',
  bookmarkFile: 'browser:import-bookmark-file',
} as const);

export type BrowserImportProfile = Readonly<{
  id: string;
  browser: 'chrome' | 'edge';
  name: string;
}>;

export type BrowserImportExtension = Readonly<{
  id: string;
  name: string;
  enabled: boolean;
  compatible: boolean;
  installed: boolean;
}>;

export type BrowserImportPreview = Readonly<{
  bookmarks: BrowserBookmarkTree;
  extensions: readonly BrowserImportExtension[];
}>;

export type BrowserExtensionImportResult = Readonly<{
  imported: readonly string[];
  skipped: readonly string[];
  failed: readonly string[];
}>;

export interface BrowserImportBridge {
  listBrowserImportProfiles(): Promise<readonly BrowserImportProfile[]>;
  previewBrowserImport(profileId: string): Promise<BrowserImportPreview>;
  importBrowserExtensions(profileId: string, extensionIds: readonly string[]): Promise<BrowserExtensionImportResult>;
  chooseBrowserBookmarkFile(): Promise<Readonly<{ sourceId: string; html: string }> | null>;
}
