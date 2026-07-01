import { describe, expect, it } from 'vitest';
import { clampWorkspaceWidthForLayout } from './useDesktopPanelResize.js';

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
});
