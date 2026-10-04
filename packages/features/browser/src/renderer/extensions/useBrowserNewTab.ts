import { useEffect } from 'react';
import type { BrowserExtension } from '../../contracts/extensions.js';

export function useBrowserNewTab({ ready, extensions, showingHome, url, onResolve, enabled = true }: {
  enabled?: boolean;
  ready: boolean;
  extensions: readonly BrowserExtension[];
  showingHome: boolean;
  url: string;
  onResolve(extension: BrowserExtension | null): void;
}) {
  useEffect(() => {
    if (!ready) return;
    const selected = enabled ? extensions.find((extension) => extension.newTabUrl) ?? null : null;
    // Only an untouched home or a removed extension is redirected. A late IPC
    // response must not replace a website the user has already navigated to.
    if (showingHome) {
      if (selected) onResolve(selected);
    } else if (url.startsWith('chrome-extension://')) {
      const id = new URL(url).hostname;
      if (!extensions.some((extension) => extension.id === id)
        || (!enabled && extensions.some((extension) => isExtensionNewTab(url, extension.newTabUrl)))) onResolve(selected);
    }
  }, [enabled, extensions, onResolve, ready, showingHome, url]);
}

export function isExtensionNewTab(url: string, newTabUrl: string | null): boolean {
  return Boolean(newTabUrl && url.split('#')[0] === newTabUrl.split('#')[0]);
}
