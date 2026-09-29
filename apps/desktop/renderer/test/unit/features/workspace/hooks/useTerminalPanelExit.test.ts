// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTerminalPanelExit, type TerminalSessionsByPanelId } from '../../../../../src/features/workspace/hooks/useTerminalPanelExit.js';
import type { DesktopTerminalEvent } from '../../../../../src/features/workspace/model.js';

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
});

const sessions: TerminalSessionsByPanelId = {
  tab: { project: { sessionId: 'shell', workspaceRoot: '/repo', shell: 'zsh', cols: 80, rows: 24 } },
};
const exit: DesktopTerminalEvent = { seq: 2, event: 'exit', data: { exitCode: 0 } };
const ready: DesktopTerminalEvent = { seq: 3, event: 'ready', data: {} };

it('catches an exit before subscription, deduplicates its live event, and ignores obsolete history after a ready event', async () => {
  let listener!: (event: DesktopTerminalEvent) => void;
  const read = vi.fn().mockResolvedValue([exit]);
  const onEvent = vi.fn((_sessionId: string, callback: typeof listener) => { listener = callback; return vi.fn(); });
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { terminal: { read, onEvent } } });
  const onExit = vi.fn();
  const view = renderHook(({ items }) => useTerminalPanelExit(items, onExit), { initialProps: { items: sessions } });
  await waitFor(() => expect(onExit).toHaveBeenCalledExactlyOnceWith('tab'));
  act(() => listener(exit));
  expect(onExit).toHaveBeenCalledTimes(1);

  view.rerender({ items: { ...sessions } });
  // A new ready event can arrive before the older history read completes.
  act(() => listener(ready));
  await act(async () => undefined);
  expect(onExit).toHaveBeenCalledTimes(1);
  act(() => listener({ ...exit, seq: 4 }));
  expect(onExit).toHaveBeenCalledTimes(2);
});

it('ignores a disposed history response and still observes live exit events if history reading fails', async () => {
  let restore!: (events: DesktopTerminalEvent[]) => void;
  let listener!: (event: DesktopTerminalEvent) => void;
  const unsubscribe = vi.fn();
  const read = vi.fn().mockImplementationOnce(() => new Promise<DesktopTerminalEvent[]>((resolve) => { restore = resolve; }))
    .mockRejectedValue(new Error('History unavailable'));
  const onEvent = vi.fn((_sessionId: string, callback: typeof listener) => { listener = callback; return unsubscribe; });
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { terminal: { read, onEvent } } });
  const onExit = vi.fn();
  const view = renderHook(({ items }) => useTerminalPanelExit(items, onExit), { initialProps: { items: sessions } });
  const staleListener = listener;
  view.rerender({ items: {} });
  expect(unsubscribe).toHaveBeenCalledOnce();
  await act(async () => { restore([exit]); staleListener(exit); });
  expect(onExit).not.toHaveBeenCalled();

  view.rerender({ items: sessions });
  await act(async () => undefined);
  act(() => listener(exit));
  expect(onExit).toHaveBeenCalledExactlyOnceWith('tab');
});
