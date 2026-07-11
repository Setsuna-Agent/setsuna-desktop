import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppTopbarActions } from './AppTopbarActions.js';
import type { DesktopUpdaterStateView } from '../../hooks/useDesktopUpdater.js';

describe('AppTopbarActions', () => {
  it('在普通对话中显示右侧栏入口', () => {
    const html = renderActions({ activeView: 'chat', sidePanelVisible: false });

    expect(html).toContain('aria-label="打开右侧栏"');
  });

  it('右侧栏已打开时隐藏重复入口', () => {
    const html = renderActions({ activeView: 'chat', sidePanelVisible: true });

    expect(html).not.toContain('aria-label="打开右侧栏"');
  });
});

function renderActions({
  activeView,
  sidePanelVisible,
}: {
  activeView: 'chat' | 'capabilities' | 'settings';
  sidePanelVisible: boolean;
}): string {
  return renderToStaticMarkup(createElement(AppTopbarActions, {
    activeView,
    bottomTerminalPanelOpen: false,
    onToggleBottomTerminal: vi.fn(),
    onToggleSidePanel: vi.fn(),
    sidePanelVisible,
    updater: { ready: false } as DesktopUpdaterStateView,
  }));
}
