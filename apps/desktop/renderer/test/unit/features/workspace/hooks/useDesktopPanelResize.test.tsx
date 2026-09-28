// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesktopPanelResize } from '../../../../../src/features/workspace/hooks/useDesktopPanelResize.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([false, true])('preserves the workspace sizing mode across sidebar collapse/expand (customized: %s)', (customized) => {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  const viewportWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1400);
  const flushFrames = () => act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
  const { result } = renderHook(() => {
    const shellRef = useRef<HTMLDivElement | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const resize = useDesktopPanelResize(shellRef, { sidebarManuallyCollapsed: collapsed });
    return {
      resize,
      collapse: () => setCollapsed(true),
      expand: () => { resize.fitWorkspaceForExpandedSidebar(); setCollapsed(false); },
    };
  });
  flushFrames();
  if (customized) act(() => result.current.resize.handleWorkspaceResizeStep(40));
  const originalPreference = result.current.resize.workspaceWidth;
  act(() => result.current.collapse());
  flushFrames();
  act(() => result.current.expand());
  flushFrames();
  expect(result.current.resize.workspaceWidth).toBe(originalPreference);

  viewportWidth.mockReturnValue(1600);
  act(() => window.dispatchEvent(new Event('resize')));
  flushFrames();
  if (customized) {
    expect(result.current.resize.workspaceWidth).toBe(originalPreference);
  } else {
    expect(result.current.resize.workspaceWidth).not.toBe(originalPreference);
    // Compare automatic behavior with a fresh session, without asserting layout dimensions.
    const fresh = renderHook(() => useDesktopPanelResize(useRef<HTMLDivElement | null>(null)));
    flushFrames();
    expect(result.current.resize.workspaceWidth).toBe(fresh.result.current.workspaceWidth);
  }
});
