import { useCallback, useRef, useState } from 'react';
import type { BrowserDesktopBridge, BrowserExtensionPopupAnchor, BrowserExtensionView } from '../../contracts/index.js';
import type { BrowserNotify } from '../types.js';
import type { BrowserTranslate } from '../messages.js';
import { useBrowserExtensionPins } from './useBrowserExtensionPins.js';
import { useBrowserExtensionActions } from './useBrowserExtensionActions.js';
import { useInstalledBrowserExtensions } from './useInstalledBrowserExtensions.js';

export function useBrowserExtensions(bridge: BrowserDesktopBridge | null, notify: BrowserNotify, translate: BrowserTranslate, webContentsId?: number) {
  const { extensions: installed, ready } = useInstalledBrowserExtensions(bridge);
  const actions = useBrowserExtensionActions(bridge, webContentsId);
  const extensions = installed.map((extension) => {
    const action = actions.find(({ id }) => id === extension.id);
    return { ...extension, actionIcon: action?.icon ?? extension.actionIcon, actionTitle: action?.title ?? extension.name,
      hasPopup: action?.popup === undefined ? extension.hasPopup : Boolean(action.popup) };
  });
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const pins = useBrowserExtensionPins();

  const run = useCallback(async (action: () => Promise<boolean>) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    try {
      if (!await action()) throw new Error('Extension action unavailable.');
      return true;
    } catch {
      notify('error', translate('feature.browser.extension.failed'));
      return false;
    } finally { running.current = false; setBusy(false); }
  }, [notify, translate]);

  return {
    extensions, busy, ready, available: Boolean(bridge?.getExtensions),
    pinnedIds: pins.pinnedIds,
    pinnedExtensions: pins.pinnedIds.flatMap((id) => extensions.filter((extension) => extension.enabled && extension.id === id)),
    togglePin: (id: string) => {
      if (!extensions.some((extension) => extension.id === id)) return;
      try { pins.togglePin(id); }
      catch { notify('error', translate('feature.browser.extension.failed')); }
    },
    newTabUrl: extensions.find((extension) => extension.enabled && extension.newTabUrl)?.newTabUrl ?? null,
    setEnabled: (id: string, enabled: boolean) => bridge ? run(() => bridge.setExtensionEnabled(id, enabled)) : Promise.resolve(false),
    setUserScriptsAllowed: (id: string, allowed: boolean) => bridge ? run(() => bridge.setExtensionUserScriptsAllowed(id, allowed)) : Promise.resolve(false),
    open: (id: string, view: BrowserExtensionView, anchor?: BrowserExtensionPopupAnchor) => bridge
      ? run(() => bridge.openExtension(id, view, anchor, webContentsId)) : Promise.resolve(false),
    remove: (id: string) => bridge ? run(() => bridge.removeExtension(id)) : Promise.resolve(false),
  };
}
