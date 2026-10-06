// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserDesktopBridge } from '../../../src/contracts/bridge.js';
import { useBrowserFind } from '../../../src/renderer/find/useBrowserFind.js';
import { translateBrowserMessage } from '../../../src/renderer/messages.js';

afterEach(cleanup);

it('ignores stale native results after changing the query, closing find, hiding the tab and navigation', () => {
  let requested!: (tabId: string) => void;
  let requestId = 0;
  const node = Object.assign(new EventTarget(), {
    isConnected: true, focus: vi.fn(), findInPage: vi.fn(() => ++requestId), stopFindInPage: vi.fn(),
  });
  const options = {
    bridge: { onFindInPageRequested: (callback: typeof requested) => { requested = callback; return () => undefined; } } as BrowserDesktopBridge,
    tabId: 'tab-1', webviewRef: { current: node }, notify: vi.fn(),
    translate: (key: Parameters<typeof translateBrowserMessage>[1]) => translateBrowserMessage('en-US', key),
  };
  const { result, rerender } = renderHook(({ available }) => useBrowserFind({ ...options, available }), { initialProps: { available: true } });
  const found = (id: number, matches: number) => act(() => node.dispatchEvent(Object.assign(new Event('found-in-page'), {
    result: { requestId: id, activeMatchOrdinal: matches ? 1 : 0, matches, finalUpdate: true },
  })));
  act(() => requested('tab-1'));
  act(() => result.current.changeQuery('first'));
  const first = requestId;
  act(() => result.current.changeQuery('second'));
  found(first, 10);
  expect(result.current.result).toBeNull();
  found(requestId, 2);
  expect(result.current.result).toEqual({ current: 1, total: 2 });
  act(() => result.current.close());
  found(requestId, 20);
  expect(result.current.open).toBe(false);
  expect(result.current.result).toBeNull();
  act(() => requested('tab-1'));
  rerender({ available: false });
  found(requestId, 20);
  act(() => requested('tab-1'));
  expect(result.current.open).toBe(false);
  rerender({ available: true });
  act(() => requested('tab-1'));
  act(() => result.current.reset());
  found(requestId, 20);
  expect(result.current.query).toBe('');
  expect(result.current.open).toBe(false);
  expect(result.current.result).toBeNull();
  expect(node.stopFindInPage).toHaveBeenCalledWith('clearSelection');
});
