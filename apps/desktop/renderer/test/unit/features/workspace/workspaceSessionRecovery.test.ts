import { expect, it } from 'vitest';
import { recoverWorkspaceLayout, savedWorkspaceLayout } from '../../../../src/features/workspace/workspaceSessionRecovery.js';
import { createBrowserPanel, createFilePanel } from '../../../../src/features/workspace/model.js';

it('recovers valid entries while excluding transient operations, unsafe URLs and malformed records', () => {
  const file = createFilePanel('src/中文 file.ts', 'secondary-root');
  const layout = recoverWorkspaceLayout({
    sidePanelExpanded: true,
    bottomPanelExpanded: true,
    sidePanelSlot: { active: 'amend', panels: [
      null, { id: 'broken', type: 'file', filePath: 2 },
      { id: 'amend', type: 'commit-message', rootId: 'primary-root' },
      createBrowserPanel('script', 'javascript:alert(1)'), createBrowserPanel('local', 'file:///private/file'),
      file, createBrowserPanel('tab', 'https://example.com/中文?q=1'),
    ] },
    bottomPanelSlot: { active: 'terminal', panels: [file, { id: 'terminal', type: 'terminal', rootId: 'secondary-root', sessionId: 'expired-process' }] },
  });
  expect(layout.sidePanelSlot.panels.map(({ id }) => id)).toEqual([file.id, 'tab']);
  expect(layout.sidePanelSlot.active).toBe(file.id);
  expect(layout.bottomPanelSlot).toEqual({ active: 'terminal', panels: [{ id: 'terminal', type: 'terminal', rootId: 'secondary-root' }] });
  expect(savedWorkspaceLayout(layout)).toEqual(layout);
  expect(savedWorkspaceLayout(recoverWorkspaceLayout({}))).toBeNull();
});
