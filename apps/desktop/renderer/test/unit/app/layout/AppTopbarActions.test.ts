import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopUpdaterStateView } from '../../../../src/app/controller/useDesktopUpdater.js';
import { AppTopbarActions } from '../../../../src/app/layout/AppTopbarActions.js';

describe('AppTopbarActions', () => {
  it('在普通对话中显示右侧栏入口', () => {
    const html = renderActions({ activeView: 'chat', sidePanelVisible: false });

    expect(html).toContain('aria-label="打开右侧栏"');
    expect(html).toContain('aria-label="隐藏环境信息"');
    expect(html).toContain('aria-pressed="true"');
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

  it('底栏打开时使用底部面板图标和选中背景', () => {
    const html = renderActions({ activeView: 'chat', bottomPanelVisible: true, sidePanelVisible: false });
    const bottomPanelButton = html.match(/<button aria-label="关闭底栏"[^>]*>/)?.[0] ?? '';

    expect(bottomPanelButton).toContain('aria-pressed="true"');
    expect(bottomPanelButton).toContain('is-active');
    expect(html).toContain('app-panel-placement-icon--bottom');
  });

});

function renderActions({
  activeView,
  bottomPanelVisible = false,
  conversationOverviewVisible = true,
  sidePanelVisible,
}: {
  activeView: 'chat' | 'capabilities' | 'settings';
  bottomPanelVisible?: boolean;
  conversationOverviewVisible?: boolean;
  sidePanelVisible: boolean;
}): string {
  return renderToStaticMarkup(createElement(AppTopbarActions, {
    activeView,
    bottomPanelVisible,
    conversationOverviewAvailable: true,
    conversationOverviewVisible,
    onToggleConversationOverview: vi.fn(),
    onToggleBottomTerminal: vi.fn(),
    onToggleSidePanel: vi.fn(),
    sidePanelVisible,
    updater: { ready: false } as DesktopUpdaterStateView,
  }));
}
