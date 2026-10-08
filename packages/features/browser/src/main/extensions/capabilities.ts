import type { ExtensionSystemBootstrap } from '../../contracts/extension-api.js';

/** Permission names with browser-owned API implementations; individual methods may remain unsupported. */
export const SYSTEM_EXTENSION_PERMISSIONS = [
  'debugger', 'contextMenus', 'downloads', 'webNavigation', 'nativeMessaging', 'scripting', 'cookies', 'bookmarks', 'storage',
] as const satisfies readonly (keyof ExtensionSystemBootstrap)[];

export const BRIDGED_EXTENSION_PERMISSIONS = new Set<string>([...SYSTEM_EXTENSION_PERMISSIONS, 'tabs', 'sidePanel', 'favicon']);

// Only these optional APIs currently participate in the approval and access checks.
export const OPTIONAL_EXTENSION_PERMISSIONS = new Set([
  'cookies', 'bookmarks', 'tabs', 'contextMenus', 'downloads', 'webNavigation', 'nativeMessaging', 'sidePanel', 'favicon',
]);
