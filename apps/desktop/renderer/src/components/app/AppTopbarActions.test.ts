import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppTopbarActions } from './AppTopbarActions.js';
import type { DesktopUpdaterStateView } from '../../hooks/useDesktopUpdater.js';

describe('AppTopbarActions', () => {
  it('在普通对话中显示右侧栏入口', () => {
    const html = renderActions({ activeView: 'chat', sidePanelVisible: false });

    expect(html).toContain('aria-label="打开右侧栏"');
    expect(html).toContain('aria-label="隐藏环境信息"');
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/app-shell-icon-control/g)).toHaveLength(3);
  });

  it('右侧栏已打开时隐藏重复入口', () => {
    const html = renderActions({ activeView: 'chat', sidePanelVisible: true });

    expect(html).not.toContain('aria-label="打开右侧栏"');
  });

  it('环境信息隐藏时保留顶栏恢复入口', () => {
    const html = renderActions({ activeView: 'chat', conversationOverviewVisible: false, sidePanelVisible: false });

    expect(html).toContain('aria-label="显示环境信息"');
    expect(html).toContain('aria-pressed="false"');
  });
});

function renderActions({
  activeView,
  conversationOverviewVisible = true,
  sidePanelVisible,
}: {
  activeView: 'chat' | 'capabilities' | 'settings';
  conversationOverviewVisible?: boolean;
  sidePanelVisible: boolean;
}): string {
  return renderToStaticMarkup(createElement(AppTopbarActions, {
    activeView,
    bottomTerminalPanelOpen: false,
    conversationOverviewAvailable: true,
    conversationOverviewVisible,
    onToggleConversationOverview: vi.fn(),
    onToggleBottomTerminal: vi.fn(),
    onToggleSidePanel: vi.fn(),
    sidePanelVisible,
    updater: { ready: false } as DesktopUpdaterStateView,
  }));
}
