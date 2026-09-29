import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/kernel/renderer-plugins/RendererKernelProvider.js', () => ({
  RendererOwnedListSlot: () => null,
}));

import { AppTopbarActions } from '../../../../src/app/layout/AppTopbarActions.js';
import { AppWorkspaceToolbar } from '../../../../src/app/layout/AppWorkspaceToolbar.js';
import type { DesktopWorkspacePanelsState } from '../../../../src/features/workspace/hooks/useDesktopWorkspacePanels.js';
import { createWorkspaceOverviewPanel } from '../../../../src/features/workspace/model.js';
import type { ProjectWorkspaceState } from '../../../../src/features/workspace/hooks/useProjectWorkspace.js';

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

  it('底栏打开时表达隐藏底栏', () => {
    const html = renderActions({ activeView: 'chat', bottomPanelVisible: true, sidePanelVisible: false });
    const bottomPanelButton = html.match(/<button[^>]*aria-label="隐藏底栏"[^>]*>/)?.[0] ?? '';

    expect(bottomPanelButton).toContain('aria-pressed="true"');
    expect(bottomPanelButton).toContain('is-active');
  });

  it('底栏隐藏时表达显示底栏', () => {
    const html = renderActions({
      activeView: 'chat',
      bottomPanelVisible: false,
      sidePanelVisible: false,
    });
    const bottomPanelButton = html.match(/<button[^>]*aria-label="显示底栏"[^>]*>/)?.[0] ?? '';

    expect(bottomPanelButton).toContain('aria-pressed="false"');
    expect(bottomPanelButton).not.toContain('is-active');
  });

});

describe('AppWorkspaceToolbar', () => {
  it('exposes the empty overview toolbar as a side-panel drop target', () => {
    const overview = createWorkspaceOverviewPanel();
    const workspacePanels = {
      bottomPanelVisible: true,
      sidePanelSlot: { active: overview.id, panels: [overview] },
      sidePanelPresent: true,
      sidePanelVisible: true,
      toggleBottomPanel: vi.fn(),
      toggleSidePanel: vi.fn(),
    } as unknown as DesktopWorkspacePanelsState;

    const html = renderToStaticMarkup(createElement(AppWorkspaceToolbar, {
      projectWorkspace: {} as ProjectWorkspaceState,
      workspacePanels,
      workspaceMaximized: false,
      onToggleMaximized: vi.fn(),
    }));

    expect(html).toContain('data-desktop-panel-placement="side"');
    expect(html).not.toContain('data-desktop-panel-tab-id="workspace-overview"');
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
  }));
}
