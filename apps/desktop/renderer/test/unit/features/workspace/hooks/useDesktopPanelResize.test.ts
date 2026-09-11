// @vitest-environment happy-dom

import { act, cleanup, fireEvent, renderHook, waitFor } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canWorkspaceWidthKeepExpandedSidebar,
  clampTerminalHeightForLayout,
  clampWorkspaceWidthForLayout,
  terminalHeightCssValue,
  useDesktopPanelResize,
  workspaceMaxWidthForExpandedSidebar,
  workspaceWidthCssValue,
} from '../../../../../src/features/workspace/hooks/useDesktopPanelResize.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('desktop panel resize', () => {
  it('maximizes within the chat boundary, follows window resizing, and restores the previous width after reopening', async () => {
    const shell = document.createElement('div');
    let viewport = 1920;
    vi.spyOn(shell, 'clientWidth', 'get').mockImplementation(() => viewport);
    const shellRef = { current: shell };
    const { result, rerender } = renderHook(({ visible }) => useDesktopPanelResize(shellRef, { workspaceVisible: visible }), {
      initialProps: { visible: true },
    });
    act(() => result.current.handleWorkspaceResizeStep(120));
    expect(result.current.workspaceWidth).toBe(760);
    act(() => result.current.toggleWorkspaceMaximized());
    expect(result.current.workspaceMaximized).toBe(true);
    expect(result.current.workspaceWidth).toBe(1400);
    expect(result.current.workspaceMaxWidth).toBe(1400);
    expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('1400px');

    viewport = 1400;
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(result.current.workspaceWidth).toBe(880));
    viewport = 1920;
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(result.current.workspaceWidth).toBe(1400));
    rerender({ visible: false });
    await waitFor(() => expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('0px'));
    rerender({ visible: true });
    await waitFor(() => expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('1400px'));
    act(() => result.current.toggleWorkspaceMaximized());
    expect(result.current.workspaceMaximized).toBe(false);
    expect(result.current.workspaceWidth).toBe(760);
    expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('760px');
  });

  it('hands width control back to pointer, keyboard, and sidebar expansion without snapping back to maximized', async () => {
    const shell = document.createElement('div');
    vi.spyOn(shell, 'clientWidth', 'get').mockReturnValue(1920);
    const shellRef = { current: shell };
    const { result } = renderHook(() => useDesktopPanelResize(shellRef));
    act(() => result.current.toggleWorkspaceMaximized());
    const handle = document.createElement('button');
    act(() => result.current.handleWorkspaceResizeStart({
      currentTarget: handle, clientX: 500, pointerId: 1, preventDefault() {},
    } as unknown as ReactPointerEvent<HTMLButtonElement>));
    fireEvent.pointerMove(window, { clientX: 620, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(result.current.workspaceMaximized).toBe(false);
    expect(result.current.workspaceWidth).toBe(1280);
    await waitFor(() => expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('1280px'));

    act(() => result.current.toggleWorkspaceMaximized());
    act(() => result.current.handleWorkspaceResizeStep(-80));
    expect(result.current.workspaceMaximized).toBe(false);
    expect(result.current.workspaceWidth).toBe(1320);
    act(() => result.current.toggleWorkspaceMaximized());
    act(() => result.current.fitWorkspaceForExpandedSidebar());
    expect(result.current.workspaceMaximized).toBe(false);
    expect(result.current.workspaceWidth).toBe(1160);
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('1160px'));

    act(() => result.current.handleWorkspaceResizeStart({
      currentTarget: handle, clientX: 500, pointerId: 2, preventDefault() {},
    } as unknown as ReactPointerEvent<HTMLButtonElement>));
    fireEvent.pointerMove(window, { clientX: -2000, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(result.current.workspaceWidth).toBe(1400);
    expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('1400px');
    act(() => result.current.handleWorkspaceResizeStep(1000));
    expect(result.current.workspaceWidth).toBe(1400);
  });

  it('lets the workspace panel cross the expanded-sidebar limit so the sidebar can auto-collapse', () => {
    expect(clampWorkspaceWidthForLayout(860, { sidebarWidth: 240, viewportWidth: 1320 })).toBe(800);
  });

  it('lets the workspace panel use wide windows while preserving the main column', () => {
    expect(clampWorkspaceWidthForLayout(960, { sidebarWidth: 240, viewportWidth: 1800 })).toBe(960);
    expect(clampWorkspaceWidthForLayout(1320, { sidebarWidth: 240, viewportWidth: 1800 })).toBe(1280);
    expect(clampWorkspaceWidthForLayout(1500, { sidebarWidth: 240, viewportWidth: 1800 })).toBe(1280);
  });

  it('keeps the workspace panel usable when the window is very narrow', () => {
    expect(clampWorkspaceWidthForLayout(860, { sidebarWidth: 240, viewportWidth: 900 })).toBe(410);
  });

  it('detects when a live workspace resize should collapse the expanded sidebar', () => {
    expect(canWorkspaceWidthKeepExpandedSidebar({
      sidebarWidth: 240,
      viewportWidth: 1920,
      workspaceWidth: 1160,
    })).toBe(true);
    expect(canWorkspaceWidthKeepExpandedSidebar({
      sidebarWidth: 240,
      viewportWidth: 1920,
      workspaceWidth: 1200,
    })).toBe(false);
  });

  it('calculates the workspace width that lets the expanded sidebar reserve layout', () => {
    expect(workspaceMaxWidthForExpandedSidebar({
      sidebarWidth: 240,
      viewportWidth: 1920,
    })).toBe(1160);
  });

  it('does not reserve workspace layout width while the side panel is closed', () => {
    expect(workspaceWidthCssValue(560, false)).toBe('0px');
    expect(workspaceWidthCssValue(560, true)).toBe('560px');
  });

  it('does not reserve bottom layout height while the bottom panel is closed', () => {
    expect(terminalHeightCssValue(260, false)).toBe('0px');
    expect(terminalHeightCssValue(260, true)).toBe('260px');
  });

  it('clamps the bottom panel height to leave the workbench content usable', () => {
    expect(clampTerminalHeightForLayout(520, { workbenchHeight: 620 })).toBe(360);
  });

  it('keeps the bottom panel within its configured max on tall windows', () => {
    expect(clampTerminalHeightForLayout(620, { workbenchHeight: 980 })).toBe(520);
  });

  it('keeps the bottom panel usable when the workbench is short', () => {
    expect(clampTerminalHeightForLayout(120, { workbenchHeight: 380 })).toBe(180);
  });
});
