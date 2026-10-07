import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from 'react';
import type { BrowserTranslate } from '../messages.js';

export type BrowserExtensionPanelSlot = {
  id: string;
  visible: boolean;
  webContentsId?: number;
  contentRef: RefObject<HTMLDivElement | null>;
  slotRef: RefObject<HTMLDivElement | null>;
  translate: BrowserTranslate;
};

export const BrowserExtensionPanelHostContext = createContext<{
  register(slot: BrowserExtensionPanelSlot): () => void;
  activate(id: string): void;
  activeId?: string;
  width: number;
} | null>(null);

/** Tabs reserve space for the window's guest; they never own or reparent its webview. */
export function useBrowserExtensionPanelSlot(input: Omit<BrowserExtensionPanelSlot, 'slotRef'>) {
  const host = useContext(BrowserExtensionPanelHostContext);
  const slotRef = useRef<HTMLDivElement>(null);
  const register = host?.register;
  const { id, visible, webContentsId, contentRef, translate } = input;
  useLayoutEffect(() => register?.({ id, visible, webContentsId, contentRef, slotRef, translate }),
    [register, id, visible, webContentsId, contentRef, translate]);
  return {
    slotRef,
    width: host?.activeId === id ? host.width : 0,
    activate: () => host?.activate(id),
  };
}
