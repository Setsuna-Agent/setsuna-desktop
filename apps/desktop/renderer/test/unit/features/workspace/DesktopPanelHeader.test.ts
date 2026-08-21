// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DesktopPanelHeader,
  panelCrossSlotDropTargetAtPoint,
  panelDragPreviewPosition,
  panelLauncherMenuPosition,
} from '../../../../src/features/workspace/DesktopPanelHeader.js';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('DesktopPanelHeader browser tabs', () => {
  it('keeps browser pages in the shared tab and launcher path', () => {
    const html = renderToStaticMarkup(createElement(DesktopPanelHeader, {
      activePanel: 'browser',
      activePanelId: 'browser-1',
      availablePanelTypes: ['browser'],
      onClose: () => undefined,
      onClosePanel: () => undefined,
      onOpenPanel: () => undefined,
      onSelectPanel: () => undefined,
      panels: [{ id: 'browser-1', type: 'browser', title: 'Example' }],
      placement: 'side',
    }));

    expect(html).toContain('data-desktop-panel-tab-id="browser-1"');
    expect(html).toContain('title="Example"');
    expect(html).toContain('aria-label="关闭Example"');
    expect(html).toContain('aria-label="添加面板"');
  });

  it('uses the collaboration icon for subagent tabs', () => {
    const html = renderToStaticMarkup(createElement(DesktopPanelHeader, {
      activePanel: 'subagent',
      activePanelId: 'subagent:child-1',
      onClose: () => undefined,
      onClosePanel: () => undefined,
      onSelectPanel: () => undefined,
      panels: [{
        id: 'subagent:child-1',
        type: 'subagent',
        title: 'contracts-investigator',
        subagent: { parentThreadId: 'parent-1', threadId: 'child-1' },
      }],
      placement: 'side',
    }));

    expect(html).toContain('lucide-users');
    expect(html).not.toContain('lucide-folder-open');
  });

  it('uses selected layout controls while the side and bottom panels are open', () => {
    const { getByRole } = render(createElement(DesktopPanelHeader, {
      activePanel: 'terminal',
      activePanelId: 'terminal-1',
      bottomBarActive: true,
      onClose: () => undefined,
      onClosePanel: () => undefined,
      onToggleBottomTerminal: () => undefined,
      panels: [{ id: 'terminal-1', type: 'terminal' }],
      placement: 'side',
    }));

    const bottomPanelToggle = getByRole('button', { name: '打开底栏终端' });
    expect(bottomPanelToggle.classList.contains('chat-file-review-panel__close--active')).toBe(true);
    expect(bottomPanelToggle.getAttribute('aria-pressed')).toBe('false');
    const bottomPanelIcon = bottomPanelToggle.querySelector('.app-panel-placement-icon--bottom rect');
    expect(bottomPanelIcon?.getAttribute('width')).toBe('19');
    expect(bottomPanelIcon?.getAttribute('height')).toBe('16');

    const sidePanelToggle = getByRole('button', { name: '收起右侧栏' });
    expect(sidePanelToggle.classList.contains('chat-file-review-panel__close--active')).toBe(true);
    expect(sidePanelToggle.getAttribute('aria-pressed')).toBe('true');
    const sidePanelIcon = sidePanelToggle.querySelector('.app-panel-placement-icon--side rect');
    expect(sidePanelIcon?.getAttribute('width')).toBe('16');
    expect(sidePanelIcon?.getAttribute('height')).toBe('19');
  });

  it('exposes terminal close semantics only while the bottom terminal is active', () => {
    const { getByRole } = render(createElement(DesktopPanelHeader, {
      activePanel: 'review',
      activePanelId: 'review',
      bottomBarActive: true,
      bottomTerminalActive: true,
      onClose: () => undefined,
      onToggleBottomTerminal: () => undefined,
      panels: [{ id: 'review', type: 'review' }],
      placement: 'side',
    }));

    const bottomPanelToggle = getByRole('button', { name: '关闭终端' });
    expect(bottomPanelToggle.classList.contains('chat-file-review-panel__close--active')).toBe(true);
    expect(bottomPanelToggle.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('DesktopPanelHeader launcher menu positioning', () => {
  it('opens the menu to the right from the launcher', () => {
    expect(panelLauncherMenuPosition({ bottom: 42, left: 248 }, 744)).toEqual({ left: 248, top: 48 });
  });

  it('keeps the menu inside the viewport', () => {
    expect(panelLauncherMenuPosition({ bottom: 42, left: 4 }, 744)).toEqual({ left: 8, top: 48 });
    expect(panelLauncherMenuPosition({ bottom: 42, left: 700 }, 744)).toEqual({ left: 460, top: 48 });
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

  it('moves the blank slot once per frame and deduplicates a stable target', () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const onReorderPanels = vi.fn();
    const { container } = render(createElement(DesktopPanelHeader, {
      activePanel: 'terminal',
      activePanelId: 'terminal-1',
      onClose: () => undefined,
      onClosePanel: () => undefined,
      onMovePanel: () => undefined,
      onReorderPanels,
      panels: [
        { id: 'terminal-1', type: 'terminal' },
        { id: 'files', type: 'files' },
      ],
      placement: 'bottom',
    }));
    const header = container.querySelector<HTMLElement>('[data-desktop-panel-placement="bottom"]');
    const terminalTab = container.querySelector<HTMLElement>('[data-desktop-panel-tab-id="terminal-1"]');
    const filesTab = container.querySelector<HTMLElement>('[data-desktop-panel-tab-id="files"]');
    expect(header && terminalTab && filesTab).toBeTruthy();
    if (!header || !terminalTab || !filesTab) return;

    header.getBoundingClientRect = () => domRect(0, 0, 300, 42);
    terminalTab.getBoundingClientRect = () => domRect(8, 7, 100, 28);
    filesTab.getBoundingClientRect = () => domRect(114, 7, 100, 28);
    header.setPointerCapture = vi.fn();
    header.hasPointerCapture = vi.fn(() => true);
    header.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(terminalTab, { button: 0, clientX: 24, clientY: 18, pointerId: 1 });
    expect(header.setPointerCapture).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(header, { clientX: 180, clientY: 18, pointerId: 1 });

    expect(onReorderPanels).not.toHaveBeenCalled();
    expect(terminalTab.classList.contains('is-dragging')).toBe(true);
    animationFrames.shift()?.(0);
    expect(onReorderPanels).toHaveBeenCalledWith('terminal-1', 'files', 'after');

    fireEvent.pointerMove(header, { clientX: 182, clientY: 18, pointerId: 1 });
    animationFrames.shift()?.(16);
    expect(onReorderPanels).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(header, { clientX: 180, clientY: 18, pointerId: 1 });
    expect(onReorderPanels).toHaveBeenCalledTimes(1);
  });

  it('moves the blank slot into the other header before committing the cross-slot drop', () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const onMovePanel = vi.fn();
    const { container } = render(createElement(DesktopPanelHeader, {
      activePanel: 'review',
      activePanelId: 'review',
      onClose: () => undefined,
      onClosePanel: () => undefined,
      onMovePanel,
      panels: [{ id: 'review', type: 'review' }],
      placement: 'bottom',
    }));
    const sourceHeader = container.querySelector<HTMLElement>('[data-desktop-panel-placement="bottom"]');
    const sourceTab = container.querySelector<HTMLElement>('[data-desktop-panel-tab-id="review"]');
    expect(sourceHeader && sourceTab).toBeTruthy();
    if (!sourceHeader || !sourceTab) return;

    sourceHeader.getBoundingClientRect = () => domRect(0, 100, 300, 42);
    sourceHeader.setPointerCapture = vi.fn();
    sourceHeader.hasPointerCapture = vi.fn(() => true);
    sourceHeader.releasePointerCapture = vi.fn();
    sourceTab.getBoundingClientRect = () => domRect(8, 107, 100, 28);

    const targetHeader = document.createElement('div');
    targetHeader.dataset.desktopPanelPlacement = 'side';
    targetHeader.getBoundingClientRect = () => domRect(400, 0, 300, 42);
    const targetTabs = document.createElement('span');
    targetTabs.className = 'chat-file-review-panel__tabs';
    const targetTab = document.createElement('span');
    targetTab.dataset.desktopPanelTabId = 'terminal-1';
    targetTab.getBoundingClientRect = () => domRect(410, 7, 100, 28);
    targetTabs.append(targetTab);
    targetHeader.append(targetTabs);
    document.body.append(targetHeader);

    fireEvent.pointerDown(sourceTab, { button: 0, clientX: 24, clientY: 118, pointerId: 1 });
    fireEvent.pointerMove(sourceHeader, { clientX: 430, clientY: 18, pointerId: 1 });
    animationFrames.shift()?.(0);

    const placeholder = targetTabs.querySelector('.desktop-panel-tab-drop-placeholder');
    expect(placeholder?.nextSibling).toBe(targetTab);
    expect(sourceTab.classList.contains('is-cross-slot-targeting')).toBe(true);
    expect(onMovePanel).not.toHaveBeenCalled();

    fireEvent.pointerUp(sourceHeader, { clientX: 430, clientY: 18, pointerId: 1 });
    expect(onMovePanel).toHaveBeenCalledWith('review', 'side', 'terminal-1', 'before');
    expect(targetTabs.querySelector('.desktop-panel-tab-drop-placeholder')).toBeNull();
  });

  it('does not start a cross-slot drag for the side overview launcher', () => {
    const onMovePanel = vi.fn();
    const { container } = render(createElement(DesktopPanelHeader, {
      activePanel: 'overview',
      activePanelId: 'workspace-overview',
      onClose: () => undefined,
      onMovePanel,
      panels: [{ id: 'workspace-overview', type: 'overview' }],
      placement: 'side',
    }));
    const header = container.querySelector<HTMLElement>('[data-desktop-panel-placement="side"]');
    const overviewTab = container.querySelector<HTMLElement>('[data-desktop-panel-tab-id="workspace-overview"]');
    expect(header && overviewTab).toBeTruthy();
    if (!header || !overviewTab) return;

    header.setPointerCapture = vi.fn();
    fireEvent.pointerDown(overviewTab, { button: 0, clientX: 24, clientY: 18, pointerId: 1 });

    expect(header.setPointerCapture).not.toHaveBeenCalled();
    expect(overviewTab.classList.contains('chat-file-review-panel__title--sortable')).toBe(false);
    expect(onMovePanel).not.toHaveBeenCalled();
  });
});

describe('DesktopPanelHeader cross-slot drop targeting', () => {
  it('targets an empty side overview toolbar', () => {
    const sideToolbar = document.createElement('div');
    sideToolbar.dataset.desktopPanelPlacement = 'side';
    sideToolbar.getBoundingClientRect = () => domRect(500, 0, 300, 42);
    const emptyTabs = document.createElement('span');
    emptyTabs.className = 'chat-file-review-panel__tabs';
    sideToolbar.append(emptyTabs);
    document.body.append(sideToolbar);

    expect(panelCrossSlotDropTargetAtPoint(620, 20, 'bottom')).toEqual({
      panelId: null,
      placement: 'side',
      position: 'after',
    });
  });

  it('targets the nearest tab in the other panel slot', () => {
    const sideHeader = document.createElement('div');
    sideHeader.dataset.desktopPanelPlacement = 'side';
    sideHeader.getBoundingClientRect = () => domRect(500, 0, 300, 42);
    const reviewTab = document.createElement('span');
    reviewTab.dataset.desktopPanelTabId = 'review';
    reviewTab.getBoundingClientRect = () => domRect(510, 7, 90, 28);
    const terminalTab = document.createElement('span');
    terminalTab.dataset.desktopPanelTabId = 'terminal-1';
    terminalTab.getBoundingClientRect = () => domRect(606, 7, 110, 28);
    sideHeader.append(reviewTab, terminalTab);
    document.body.append(sideHeader);

    expect(panelCrossSlotDropTargetAtPoint(620, 20, 'bottom')).toEqual({
      panelId: 'terminal-1',
      placement: 'side',
      position: 'before',
    });
  });

  it('does not select the source slot as a cross-slot target', () => {
    const bottomHeader = document.createElement('div');
    bottomHeader.dataset.desktopPanelPlacement = 'bottom';
    bottomHeader.getBoundingClientRect = () => domRect(0, 500, 800, 42);
    document.body.append(bottomHeader);

    expect(panelCrossSlotDropTargetAtPoint(200, 520, 'bottom')).toBeNull();
  });
});

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}
