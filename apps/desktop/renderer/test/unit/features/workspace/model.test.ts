import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSER_URL,
  WORKSPACE_OVERVIEW_PANEL_ID,
  addPanelToSlotState,
  createBrowserPanel,
  createConversationDebugPanel,
  createDefaultSidePanelSlot,
  createFilePanel,
  createFilesPanel,
  createReviewPanel,
  createSideChatPanel,
  createWorkspaceOverviewPanel,
  removePanelFromSlotState,
  reorderPanelInSlotState,
  updatePanelInSlotState,
} from '../../../../src/features/workspace/model.js';

describe('desktop workspace panel model', () => {
  it('opens the direct side panel on the workspace overview', () => {
    expect(createDefaultSidePanelSlot()).toEqual({
      active: WORKSPACE_OVERVIEW_PANEL_ID,
      panels: [createWorkspaceOverviewPanel()],
    });
  });

  it('keeps only one workspace overview tab', () => {
    const slot = addPanelToSlotState(
      {
        active: 'files',
        panels: [createWorkspaceOverviewPanel(), createFilesPanel()],
      },
      createWorkspaceOverviewPanel(),
    );

    expect(slot.active).toBe(WORKSPACE_OVERVIEW_PANEL_ID);
    expect(slot.panels.filter((panel) => panel.type === 'overview')).toHaveLength(1);
  });

  it('replaces the workspace overview when opening a concrete panel', () => {
    const slot = addPanelToSlotState(createDefaultSidePanelSlot(), createFilesPanel());

    expect(slot.active).toBe('files');
    expect(slot.panels.map((panel) => panel.type)).toEqual(['files']);
  });

  it('allows multiple independent side chat tabs', () => {
    const first = createSideChatPanel('side-chat-1', '侧边对话');
    const second = createSideChatPanel('side-chat-2', '侧边对话 2');
    const withChats = addPanelToSlotState(addPanelToSlotState(createDefaultSidePanelSlot(), first), second);

    expect(createSideChatPanel().title).toBe('侧边对话');
    expect(withChats.active).toBe('side-chat-2');
    expect(withChats.panels).toEqual([first, second]);
  });

  it('keeps browser pages as independent ordinary tabs', () => {
    const first = createBrowserPanel('browser-1');
    const second = createBrowserPanel('browser-2', 'https://example.com/');
    const withBrowsers = addPanelToSlotState(addPanelToSlotState(createDefaultSidePanelSlot(), first), second);

    expect(withBrowsers.active).toBe(second.id);
    expect(withBrowsers.panels).toEqual([first, second]);
  });

  it('keeps the conversation debug panel as a singleton', () => {
    const debugPanel = createConversationDebugPanel();
    const withDebug = addPanelToSlotState(
      addPanelToSlotState(createDefaultSidePanelSlot(), debugPanel),
      createConversationDebugPanel(),
    );

    expect(withDebug.active).toBe(debugPanel.id);
    expect(withDebug.panels).toEqual([debugPanel]);
  });

  it('falls back to the default browser URL for non-string click payloads', () => {
    const browser = createBrowserPanel('browser-invalid', {} as unknown as string);

    expect(browser.browser?.url).toBe(DEFAULT_BROWSER_URL);
  });

  it('updates browser tab metadata without changing its identity or order', () => {
    const browser = createBrowserPanel('browser-1');
    const slot = { active: browser.id, panels: [browser, createFilesPanel()] };
    const next = updatePanelInSlotState(slot, browser.id, {
      browser: { faviconUrl: 'https://example.com/favicon.ico', loading: false, url: 'https://example.com/' },
      title: 'Example',
    });

    expect(next.panels.map((panel) => panel.id)).toEqual(['browser-1', 'files']);
    expect(next.panels[0]).toMatchObject({
      browser: { faviconUrl: 'https://example.com/favicon.ico', loading: false, url: 'https://example.com/' },
      id: 'browser-1',
      title: 'Example',
      type: 'browser',
    });
    expect(updatePanelInSlotState(next, browser.id, {
      browser: { faviconUrl: 'https://example.com/favicon.ico', loading: false, url: 'https://example.com/' },
      title: 'Example',
    })).toBe(next);
  });

  it('reorders multiple side chat tabs', () => {
    const first = createSideChatPanel('side-chat-1', '侧边对话');
    const second = createSideChatPanel('side-chat-2', '侧边对话 2');

    const reordered = reorderPanelInSlotState({ active: second.id, panels: [first, second] }, second.id, first.id, 'before');

    expect(reordered.active).toBe(second.id);
    expect(reordered.panels).toEqual([second, first]);
  });

  it('reorders panels without changing the active tab', () => {
    const slot = {
      active: 'file:src/main.ts',
      panels: [createReviewPanel(), createFilesPanel(), createFilePanel('src/main.ts')],
    };

    const next = reorderPanelInSlotState(slot, 'file:src/main.ts', 'review', 'before');

    expect(next.active).toBe('file:src/main.ts');
    expect(next.panels.map((panel) => panel.id)).toEqual(['file:src/main.ts', 'review', 'files']);
  });

  it('can move a panel after the drop target', () => {
    const slot = {
      active: 'review',
      panels: [createReviewPanel(), createFilesPanel(), createFilePanel('src/main.ts')],
    };

    const next = reorderPanelInSlotState(slot, 'review', 'file:src/main.ts', 'after');

    expect(next.panels.map((panel) => panel.id)).toEqual(['files', 'file:src/main.ts', 'review']);
  });

  it('keeps the same slot object when the requested order is unchanged', () => {
    const slot = {
      active: 'review',
      panels: [createReviewPanel(), createFilesPanel(), createFilePanel('src/main.ts')],
    };

    expect(reorderPanelInSlotState(slot, 'review', 'files', 'before')).toBe(slot);
  });

  it('activates the next tab after closing the active middle tab', () => {
    const slot = {
      active: 'files',
      panels: [createReviewPanel(), createFilesPanel(), createFilePanel('src/main.ts')],
    };

    const next = removePanelFromSlotState(slot, 'files');

    expect(next.active).toBe('file:src/main.ts');
    expect(next.panels.map((panel) => panel.id)).toEqual(['review', 'file:src/main.ts']);
  });

  it('activates the previous tab after closing the active last tab', () => {
    const slot = {
      active: 'file:src/main.ts',
      panels: [createReviewPanel(), createFilesPanel(), createFilePanel('src/main.ts')],
    };

    const next = removePanelFromSlotState(slot, 'file:src/main.ts');

    expect(next.active).toBe('files');
    expect(next.panels.map((panel) => panel.id)).toEqual(['review', 'files']);
  });

  it('keeps the active tab when closing an inactive tab', () => {
    const slot = {
      active: 'review',
      panels: [createReviewPanel(), createFilesPanel(), createFilePanel('src/main.ts')],
    };

    expect(removePanelFromSlotState(slot, 'files').active).toBe('review');
  });
});
