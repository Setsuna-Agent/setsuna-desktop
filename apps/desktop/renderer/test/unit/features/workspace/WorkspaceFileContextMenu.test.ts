// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WorkspaceFileContextMenu,
  workspaceFileRevealLabel,
} from '../../../../src/features/workspace/WorkspaceFileContextMenu.js';
import {
  workspaceDirectoryMentionEntry,
  workspaceFileMentionEntry,
} from '../../../../src/features/workspace/workspaceFileMention.js';
import { translate, type Translate } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('workspace file context menu helpers', () => {
  it.each([null, { id: 'cursor', label: 'Cursor', icon: 'cursor' }])('opens the selected file in a tab with preferred app %j', async (selectedWorkspaceApp) => {
    const onOpenProjectFile = vi.fn();
    const onOpenWithApp = vi.fn();
    render(createElement(WorkspaceFileContextMenu, {
      openOnly: true,
      target: { filePath: 'src/app.ts', line: 12, x: 0, y: 0 },
      selectedWorkspaceApp, workspaceApps: selectedWorkspaceApp ? [selectedWorkspaceApp] : [],
      onOpenProjectFile, onOpenWithApp,
      onAddToConversation: vi.fn(), onCopyPath: vi.fn(), onReveal: vi.fn(), onClose: vi.fn(),
    }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '在新标签页中打开' }));
    expect(onOpenProjectFile).toHaveBeenCalledExactlyOnceWith('src/app.ts', 12);
    expect(onOpenWithApp).not.toHaveBeenCalled();
  });

  it('opens the chosen external app from the file opening menu', async () => {
    const cursor = { id: 'cursor', label: 'Cursor', icon: 'cursor' };
    const vscode = { id: 'vscode', label: 'VS Code', icon: 'vscode' };
    const onOpenWithApp = vi.fn();
    render(createElement(WorkspaceFileContextMenu, {
      openOnly: true,
      target: { filePath: 'src/app.ts', line: 12, x: 0, y: 0 },
      selectedWorkspaceApp: cursor, workspaceApps: [cursor, vscode], onOpenWithApp,
      onAddToConversation: vi.fn(), onCopyPath: vi.fn(), onReveal: vi.fn(), onClose: vi.fn(),
    }));
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: '打开方式' }), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'VS Code' }));
    expect(onOpenWithApp).toHaveBeenCalledExactlyOnceWith('vscode', 'src/app.ts', 12);
  });

  it('uses the platform-native folder label', () => {
    expect(workspaceFileRevealLabel('darwin')).toBe('在访达中显示');
    expect(workspaceFileRevealLabel('win32')).toBe('在文件资源管理器中显示');
    expect(workspaceFileRevealLabel('browser')).toBe('在文件夹中显示');
    const en: Translate = (key, params) => translate('en-US', key, params);
    expect(workspaceFileRevealLabel('darwin', en)).toBe('Show in Finder');
  });

  it('builds a normalized file mention for add-to-conversation', () => {
    expect(workspaceFileMentionEntry('.\\src\\domain\\agent.ts')).toEqual({
      kind: 'file',
      name: 'agent.ts',
      parent: 'src/domain',
      path: 'src/domain/agent.ts',
    });
    expect(workspaceDirectoryMentionEntry('./src/domain/')).toEqual({
      kind: 'directory',
      name: 'domain',
      parent: 'src',
      path: 'src/domain',
    });
  });
});
