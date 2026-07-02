import { describe, expect, it } from 'vitest';
import { panelDragPreviewPosition, panelLauncherMenuPosition } from './DesktopPanelHeader.js';

describe('DesktopPanelHeader launcher menu positioning', () => {
  it('opens the menu to the right from the launcher', () => {
    expect(panelLauncherMenuPosition({ bottom: 42, left: 248 }, 744)).toEqual({ left: 248, top: 48 });
  });

  it('keeps the menu inside the viewport', () => {
    expect(panelLauncherMenuPosition({ bottom: 42, left: 4 }, 744)).toEqual({ left: 8, top: 48 });
    expect(panelLauncherMenuPosition({ bottom: 42, left: 700 }, 744)).toEqual({ left: 580, top: 48 });
  });

  it('converts visual coordinates back to zoomed body coordinates', () => {
    expect(panelLauncherMenuPosition({ bottom: 84, left: 496 }, 1488, 0.5)).toEqual({ left: 248, top: 48 });
  });
});

describe('DesktopPanelHeader tab drag preview positioning', () => {
  it('keeps the preview under the pointer when the page is zoomed', () => {
    expect(
      panelDragPreviewPosition(
        { clientX: 500, clientY: 120 },
        {
          height: 28,
          offsetX: 32,
          offsetY: 10,
          scaleInverse: 0.5,
          width: 104,
        },
      ),
    ).toEqual({ height: 28, left: 218, top: 50, width: 104 });
  });
});
