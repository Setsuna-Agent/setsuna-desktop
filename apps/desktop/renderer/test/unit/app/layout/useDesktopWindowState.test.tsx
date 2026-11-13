// @vitest-environment happy-dom

import type { DesktopWindowControlsState } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesktopWindowState } from '../../../../src/app/layout/useDesktopWindowState.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  let resolve!: (value: DesktopWindowControlsState) => void;
  const snapshot = new Promise<DesktopWindowControlsState>((done) => { resolve = done; });
  let publish!: (value: DesktopWindowControlsState) => void;
  const unsubscribe = vi.fn();
  vi.stubGlobal('setsunaDesktop', { windowControls: {
    getState: () => snapshot,
    onStateChange: (callback: typeof publish) => { publish = callback; return unsubscribe; },
  } });
  const view = renderHook(useDesktopWindowState);
  return { ...view, snapshot, resolve, publish, unsubscribe };
}

it('reads a window already in fullscreen without blocking rendering and accepts native restoration', async () => {
  const view = setup();
  expect(view.result.current).toEqual({ maximized: false, fullScreen: false, focused: false });
  await act(async () => { view.resolve({ maximized: false, fullScreen: true, focused: true }); await view.snapshot; });
  expect(view.result.current).toEqual({ maximized: false, fullScreen: true, focused: true });
  act(() => view.publish({ maximized: true, fullScreen: false, focused: false }));
  expect(view.result.current).toEqual({ maximized: true, fullScreen: false, focused: false });
});

it('keeps a newer native transition when the initial snapshot arrives late and unsubscribes on unmount', async () => {
  const view = setup();
  act(() => view.publish({ maximized: false, fullScreen: true, focused: false }));
  await act(async () => { view.resolve({ maximized: true, fullScreen: false, focused: true }); await view.snapshot; });
  expect(view.result.current).toEqual({ maximized: false, fullScreen: true, focused: false });
  view.unmount();
  expect(view.unsubscribe).toHaveBeenCalledOnce();
});
