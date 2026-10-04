import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserDesktopBridge, BrowserPasswordState } from '../../contracts/index.js';
import type { BrowserNotify } from '../types.js';
import type { BrowserTranslate } from '../messages.js';

export function useBrowserPasswords({ bridge, tabId, active, notify, translate: t }: {
  bridge: BrowserDesktopBridge | null;
  tabId: string;
  active: boolean;
  notify: BrowserNotify;
  translate: BrowserTranslate;
}) {
  const [state, setState] = useState<BrowserPasswordState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const generation = useRef(0);
  const promptId = useRef<string | null>(null);

  useEffect(() => {
    ++generation.current;
    setState(null);
    setOpen(false);
    promptId.current = null;
    if (!bridge || !active) return;
    let live = true;
    let received = false;
    const accept = (next: BrowserPasswordState) => {
      if (!live || next.tabId !== tabId) return;
      received = true;
      setState(next);
      if (next.prompt && next.prompt.id !== promptId.current) setOpen(true);
      promptId.current = next.prompt?.id ?? null;
      if (!next.prompt && !next.logins.length) setOpen(false);
    };
    const unsubscribe = bridge.onPasswordState(accept);
    void bridge.getPasswordState(tabId).then((next) => {
      if (!received && next) accept(next);
    }).catch(() => undefined);
    return () => { live = false; ++generation.current; unsubscribe(); };
  }, [active, bridge, tabId]);

  const run = useCallback(async (action: () => Promise<boolean | void>, kind: 'save' | 'fill' | 'delete' | 'dismiss') => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    const current = generation.current;
    try {
      const result = await action();
      if (current !== generation.current) return;
      if (result === false) throw new Error('Password action unavailable.');
      if (kind === 'fill' || kind === 'save') setOpen(false);
    } catch {
      if (current === generation.current) notify('error', t(kind === 'fill' ? 'feature.browser.password.fillFailed' : 'feature.browser.password.failed'));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }, [notify, t]);

  const dismiss = () => {
    setOpen(false);
    if (bridge && state?.prompt) void run(() => bridge.dismissPassword(tabId, state.prompt!.id), 'dismiss');
  };
  return {
    state, open, setOpen, busy, dismiss,
    save: () => { if (bridge && state?.prompt) void run(() => bridge.savePassword(tabId, state.prompt!.id), 'save'); },
    fill: (id: string) => { if (bridge) void run(() => bridge.fillPassword(tabId, id), 'fill'); },
    remove: (id: string) => { if (bridge) void run(() => bridge.deletePassword(tabId, id), 'delete'); },
  };
}
