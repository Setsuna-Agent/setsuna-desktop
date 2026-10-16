// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkspaceRecoveryKey } from '../../../../../src/features/workspace/hooks/useWorkspaceRecoveryKey.js';
import { useDesktopWorkspacePanelSession } from '../../../../../src/features/workspace/hooks/useDesktopWorkspacePanelSession.js';
import { createBrowserPanel } from '../../../../../src/features/workspace/model.js';
import { writeSessionRecord } from '../../../../../src/shared/preferences/sessionStorage.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); vi.useRealTimers(); });

function scheduledRecovery() {
  vi.useFakeTimers();
  let sequence = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++sequence, callback); return sequence; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  const paint = () => act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(performance.now());
  });
  const scope = 'primary:0';
  writeSessionRecord(scope, 'panels', 'thread:A', {
    sidePanelExpanded: true, sidePanelSlot: { active: 'saved-tab', panels: [createBrowserPanel('saved-tab', 'https://example.com')] },
  });
  const reads = vi.spyOn(window.localStorage, 'getItem');
  const view = renderHook(() => {
    const key = useWorkspaceRecoveryKey(scope);
    return { key, panels: useDesktopWorkspacePanelSession('thread:A', key) };
  });
  return { view, reads, paint, frames };
}

it('paints the shell before reading saved panels and cancels deferred work on window closure', () => {
  const { view, reads, paint, frames } = scheduledRecovery();
  expect(view.result.current.key).toBeNull();
  expect(reads).not.toHaveBeenCalled();
  paint();
  expect(reads).not.toHaveBeenCalled();
  view.unmount();
  paint();
  act(() => vi.runAllTimers());
  expect(frames.size).toBe(0);
  expect(reads).not.toHaveBeenCalled();
});

it.each(['saved', 'opened', 'closed'] as const)('restores after paint while respecting early user actions (%s)', (action) => {
  const { view, reads, paint } = scheduledRecovery();
  if (action !== 'saved') act(() => {
    view.result.current.panels.setSidePanelSlot({ active: 'user-tab', panels: [createBrowserPanel('user-tab')] });
  });
  if (action === 'closed') act(() => view.result.current.panels.resetForIdentity('thread:A'));
  paint();
  paint();
  expect(reads).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(0));
  expect(view.result.current.key).toBe('primary:0');
  expect(view.result.current.panels.sidePanelSlot.panels.map(({ id }) => id))
    .toEqual(action === 'saved' ? ['saved-tab'] : action === 'opened' ? ['user-tab'] : []);
  view.unmount();
  const restarted = renderHook(() => useDesktopWorkspacePanelSession('thread:A', 'primary:0'));
  expect(restarted.result.current.sidePanelSlot.panels.map(({ id }) => id))
    .toEqual(action === 'saved' ? ['saved-tab'] : action === 'opened' ? ['user-tab'] : []);
});
