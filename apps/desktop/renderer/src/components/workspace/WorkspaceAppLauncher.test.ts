import { describe, expect, it } from 'vitest';
import { workspaceAppLauncherMenuPosition } from './WorkspaceAppLauncher.js';

describe('workspaceAppLauncherMenuPosition', () => {
  it('right-aligns the menu with its launcher at the default page scale', () => {
    expect(workspaceAppLauncherMenuPosition({
      menuHeight: 178,
      menuWidth: 196,
      rect: { bottom: 40, right: 400 },
      viewportHeight: 900,
      viewportWidth: 744,
    })).toEqual({ left: 204, top: 46 });
  });

  it('converts the launcher coordinates back into the zoomed body coordinate space', () => {
    expect(workspaceAppLauncherMenuPosition({
      menuHeight: 178,
      menuWidth: 196,
      rect: { bottom: 84, right: 496 },
      scaleInverse: 0.5,
      viewportHeight: 900,
      viewportWidth: 1488,
    })).toEqual({ left: 52, top: 48 });
  });

  it('keeps the menu inside the scaled viewport', () => {
    expect(workspaceAppLauncherMenuPosition({
      menuHeight: 178,
      menuWidth: 196,
      rect: { bottom: 890, right: 80 },
      viewportHeight: 900,
      viewportWidth: 744,
    })).toEqual({ left: 8, top: 714 });
  });
});
