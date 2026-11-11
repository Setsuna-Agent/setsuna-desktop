// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesktopWorkbenchLayout } from '../../../../src/app/controller/useDesktopWorkbenchLayout.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps a manually opened sidebar accessible beside a wide workspace and preserves the split preference', () => {
  const flushFrames = mockAnimationFrames();
  const viewportWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1920);
  const { result } = renderHook(() => useDesktopWorkbenchLayout(useRef<HTMLDivElement | null>(null), {
    activeView: 'chat', workspaceVisible: true, bottomPanelVisible: false,
  }));
  flushFrames();
  act(() => result.current.handleWorkspaceResizeStep(Number.POSITIVE_INFINITY));
  flushFrames();
  const preferredWidth = result.current.workspaceWidth;
  expect(result.current.sidebarCollapsed).toBe(true);

  act(() => result.current.setSidebarCollapsed((collapsed) => !collapsed));
  flushFrames();
  expect(result.current.sidebarCollapsed).toBe(false);
  expect(result.current.workspaceSinglePane).toBe(false);

  // Subsequent window constraints must not reinterpret the explicit expand as automatic mode.
  viewportWidth.mockReturnValue(1100);
  act(() => window.dispatchEvent(new Event('resize')));
  flushFrames();
  expect(result.current.sidebarCollapsed).toBe(false);
  viewportWidth.mockReturnValue(1920);
  act(() => window.dispatchEvent(new Event('resize')));
  flushFrames();
  expect(result.current.sidebarCollapsed).toBe(false);

  act(() => result.current.setSidebarCollapsed(true));
  flushFrames();
  expect(result.current.sidebarCollapsed).toBe(true);
  expect(result.current.workspaceWidth).toBe(preferredWidth);
});

it('adapts an untouched sidebar to window constraints without undoing a later explicit collapse', () => {
  const flushFrames = mockAnimationFrames();
  const viewportWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1400);
  const { result } = renderHook(() => useDesktopWorkbenchLayout(useRef<HTMLDivElement | null>(null), {
    activeView: 'chat', workspaceVisible: true, bottomPanelVisible: false,
  }));
  flushFrames();
  expect(result.current.sidebarCollapsed).toBe(false);
  viewportWidth.mockReturnValue(700);
  act(() => window.dispatchEvent(new Event('resize')));
  flushFrames();
  expect(result.current.sidebarCollapsed).toBe(true);
  viewportWidth.mockReturnValue(1400);
  act(() => window.dispatchEvent(new Event('resize')));
  flushFrames();
  expect(result.current.sidebarCollapsed).toBe(false);

  act(() => result.current.setSidebarCollapsed(true));
  viewportWidth.mockReturnValue(1600);
  act(() => window.dispatchEvent(new Event('resize')));
  flushFrames();
  expect(result.current.sidebarCollapsed).toBe(true);
});

function mockAnimationFrames() {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  return () => act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}
