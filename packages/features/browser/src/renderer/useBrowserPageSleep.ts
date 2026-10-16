import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserDesktopBridge, BrowserPageSleepResult } from '../contracts/index.js';
import type { BrowserTranslate } from './messages.js';
import type { BrowserNotify } from './types.js';

export function useBrowserPageSleep({ bridge, tabId, available, hidden, notify, translate }: {
  bridge: BrowserDesktopBridge | null;
  tabId: string;
  available: boolean;
  hidden: boolean;
  notify: BrowserNotify;
  translate: BrowserTranslate;
}) {
  const [suspended, setSuspended] = useState(false);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const changing = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setSuspended(false);
    setPending(false);
    changing.current = false;
    if (!available || !bridge) return;
    let receivedEvent = false;
    const unsubscribe = bridge.onPageSleepStateChanged((state) => {
      if (state.tabId !== tabId) return;
      receivedEvent = true;
      setSuspended(state.suspended);
    });
    void bridge.getPageSleepState(tabId).then((state) => {
      if (generation.current === current && !receivedEvent && state) setSuspended(state.suspended);
    }).catch(() => undefined);
    return () => { generation.current += 1; unsubscribe(); };
  }, [available, bridge, tabId]);

  const change = useCallback(async (sleep: boolean) => {
    if (!bridge || !available || changing.current) return;
    const current = generation.current;
    changing.current = true;
    setPending(true);
    const result: BrowserPageSleepResult = await bridge.setPageSuspended(tabId, sleep)
      .catch(() => ({ suspended: sleep ? false : true, blocker: 'unavailable' } as const));
    if (generation.current !== current) return;
    changing.current = false;
    setPending(false);
    // The state event is authoritative; a later tool wake must win over this reply.
    if (result.blocker) notify('warning', translate(`feature.browser.sleep.${result.blocker}`));
  }, [available, bridge, notify, tabId, translate]);

  // Only becoming visible wakes a tab; manually sleeping the visible tab stays asleep.
  useEffect(() => {
    if (!hidden && available && bridge) void bridge.setPageSuspended(tabId, false).catch(() => undefined);
  }, [available, bridge, hidden, tabId]);

  return { suspended: available && suspended, pending, change };
}
