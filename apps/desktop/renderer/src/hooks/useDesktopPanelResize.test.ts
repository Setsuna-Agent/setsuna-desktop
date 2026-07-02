import { describe, expect, it } from 'vitest';
import { clampTerminalHeightForLayout, clampWorkspaceWidthForLayout, terminalHeightCssValue, workspaceWidthCssValue } from './useDesktopPanelResize.js';

describe('desktop panel resize', () => {
  it('clamps the side workspace width to the restored window layout', () => {
    expect(clampWorkspaceWidthForLayout(860, { sidebarWidth: 240, viewportWidth: 1320 })).toBe(660);
  });

  it('keeps the workspace panel within its configured max on wide windows', () => {
    expect(clampWorkspaceWidthForLayout(960, { sidebarWidth: 240, viewportWidth: 1800 })).toBe(860);
  });

  it('keeps the workspace panel usable when the window is very narrow', () => {
    expect(clampWorkspaceWidthForLayout(860, { sidebarWidth: 240, viewportWidth: 900 })).toBe(460);
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
