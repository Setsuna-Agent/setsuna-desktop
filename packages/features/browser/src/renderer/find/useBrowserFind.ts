import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import type { BrowserDesktopBridge } from '../../contracts/bridge.js';
import type { BrowserTranslate } from '../messages.js';
import type { BrowserNotify } from '../types.js';

export type BrowserFindWebview = {
  readonly isConnected: boolean;
  focus(): void;
  findInPage(text: string, options: { forward?: boolean; findNext: boolean }): number;
  stopFindInPage(action: 'clearSelection'): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
};

type FindResult = { requestId: number; activeMatchOrdinal: number; matches: number; finalUpdate: boolean };

export function useBrowserFind({ available, bridge, notify, tabId, translate, webviewRef }: {
  available: boolean;
  bridge: BrowserDesktopBridge | null;
  notify: BrowserNotify;
  tabId: string;
  translate: BrowserTranslate;
  webviewRef: RefObject<BrowserFindWebview | null>;
}) {
  const [focusRequest, setFocusRequest] = useState(0);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ current: number; total: number } | null>(null);
  const requestIdRef = useRef<number | null>(null);
  const open = available && focusRequest > 0;

  const stop = useCallback(() => {
    const searching = requestIdRef.current !== null;
    requestIdRef.current = null;
    if (!searching) return;
    try { webviewRef.current?.stopFindInPage('clearSelection'); }
    catch { /* Navigation or detachment may already have ended the native find session. */ }
  }, [webviewRef]);

  const close = useCallback((restoreFocus = true) => {
    stop();
    setFocusRequest(0);
    setResult(null);
    try { if (restoreFocus && webviewRef.current?.isConnected) webviewRef.current.focus(); }
    catch { /* A closing guest does not have a focus target anymore. */ }
  }, [stop, webviewRef]);

  const show = useCallback(() => {
    if (available && webviewRef.current?.isConnected) setFocusRequest((current) => current + 1);
  }, [available, webviewRef]);

  useEffect(() => bridge?.onFindInPageRequested?.((id) => {
    if (id === tabId) show();
  }), [bridge, show, tabId]);

  useEffect(() => {
    if (!available) close(false);
  }, [available, close]);
  useEffect(() => stop, [stop]);

  useEffect(() => {
    const node = webviewRef.current;
    if (!open || !node) return undefined;
    const found = (event: { result: FindResult }) => {
      // Chromium replies asynchronously; an earlier query or a closed bar must not replace the current result.
      if (event.result.requestId !== requestIdRef.current || !event.result.finalUpdate) return;
      setResult({ current: event.result.activeMatchOrdinal, total: event.result.matches });
    };
    node.addEventListener('found-in-page', found);
    return () => node.removeEventListener('found-in-page', found);
  }, [open, webviewRef]);

  const search = useCallback((text: string, newSession: boolean, forward = true) => {
    try {
      const node = webviewRef.current;
      if (!node?.isConnected) return;
      // Electron's findNext flag starts a new session when true; match navigation uses false.
      requestIdRef.current = node.findInPage(text, { findNext: newSession, forward });
    } catch (error) {
      console.warn('[browser] could not search the current page', error);
      notify('warning', translate('feature.browser.find.failed'));
    }
  }, [notify, translate, webviewRef]);

  useEffect(() => {
    if (!open) return;
    stop();
    setResult(null);
    if (query) search(query, true);
  }, [open, query, search, stop]);

  const changeQuery = useCallback((value: string) => {
    stop();
    setResult(null);
    setQuery(value);
  }, [stop]);

  const reset = useCallback(() => {
    close(false);
    setQuery('');
  }, [close]);

  const move = (forward: boolean) => {
    if (open && query && result?.total) search(query, false, forward);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.repeat) return;
    if (event.code === 'KeyF' && event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      show();
    }
  };

  return { open, focusRequest, query, result, changeQuery, close, move, onKeyDown, reset };
}

export type BrowserFindState = ReturnType<typeof useBrowserFind>;
