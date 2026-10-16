// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserDesktopBridge, BrowserPageSleepResult, BrowserPageSleepState } from '../../src/contracts/index.js';
import { useBrowserPageSleep } from '../../src/renderer/useBrowserPageSleep.js';
import { translateBrowserMessage } from '../../src/renderer/messages.js';

afterEach(cleanup);

it('keeps an explicit sleep until activation and lets later state events win over stale replies', async () => {
  let publish!: (state: BrowserPageSleepState) => void;
  let reply!: (result: BrowserPageSleepResult) => void;
  const unsubscribe = vi.fn();
  const bridge = {
    getPageSleepState: vi.fn(async () => null),
    onPageSleepStateChanged: (listener: typeof publish) => { publish = listener; return unsubscribe; },
    setPageSuspended: vi.fn(async (_id: string, suspended: boolean): Promise<BrowserPageSleepResult> => ({ suspended })),
  };
  const options = { bridge: bridge as unknown as BrowserDesktopBridge, tabId: 'tab-1', available: true,
    notify: vi.fn(), translate: (key: Parameters<typeof translateBrowserMessage>[1]) => translateBrowserMessage('en-US', key) };
  const { result, rerender, unmount } = renderHook(({ hidden }) => useBrowserPageSleep({ ...options, hidden }), { initialProps: { hidden: false } });
  await act(async () => undefined);
  bridge.setPageSuspended.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
  let action!: Promise<void>;
  act(() => { action = result.current.change(true); publish({ tabId: 'tab-1', suspended: true }); });
  expect(result.current.suspended).toBe(true);
  expect(bridge.setPageSuspended).toHaveBeenCalledTimes(2);
  act(() => publish({ tabId: 'tab-1', suspended: false }));
  await act(async () => { reply({ suspended: true }); await action; });
  expect(result.current.suspended).toBe(false);
  act(() => publish({ tabId: 'tab-1', suspended: true }));
  rerender({ hidden: true });
  expect(result.current.suspended).toBe(true);
  rerender({ hidden: false });
  expect(bridge.setPageSuspended).toHaveBeenLastCalledWith('tab-1', false);
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
