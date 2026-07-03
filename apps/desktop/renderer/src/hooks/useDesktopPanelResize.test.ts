import { describe, expect, it } from 'vitest';
import {
  canWorkspaceWidthKeepExpandedSidebar,
  clampTerminalHeightForLayout,
  clampWorkspaceWidthForLayout,
  terminalHeightCssValue,
  workspaceMaxWidthForExpandedSidebar,
  workspaceWidthCssValue,
} from './useDesktopPanelResize.js';

describe('desktop panel resize', () => {
  it('lets the workspace panel cross the expanded-sidebar limit so the sidebar can auto-collapse', () => {
    expect(clampWorkspaceWidthForLayout(860, { sidebarWidth: 240, viewportWidth: 1320 })).toBe(860);
  });

  it('lets the workspace panel use wide windows while preserving the main column', () => {
    expect(clampWorkspaceWidthForLayout(960, { sidebarWidth: 240, viewportWidth: 1800 })).toBe(960);
    expect(clampWorkspaceWidthForLayout(1320, { sidebarWidth: 240, viewportWidth: 1800 })).toBe(1320);
    expect(clampWorkspaceWidthForLayout(1500, { sidebarWidth: 240, viewportWidth: 1800 })).toBe(1380);
  });

  it('keeps the workspace panel usable when the window is very narrow', () => {
    expect(clampWorkspaceWidthForLayout(860, { sidebarWidth: 240, viewportWidth: 900 })).toBe(480);
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
