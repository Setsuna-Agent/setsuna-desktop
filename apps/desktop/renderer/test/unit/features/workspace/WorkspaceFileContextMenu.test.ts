import { describe, expect, it } from 'vitest';
import {
  workspaceFileMentionEntry,
  workspaceFileRevealLabel,
} from '../../../../src/features/workspace/WorkspaceFileContextMenu.js';
import { translate, type Translate } from '../../../../src/shared/i18n/I18nProvider.js';

describe('workspace file context menu helpers', () => {
  it('uses the platform-native folder label', () => {
    expect(workspaceFileRevealLabel('darwin')).toBe('在访达中显示');
    expect(workspaceFileRevealLabel('win32')).toBe('在文件资源管理器中显示');
    expect(workspaceFileRevealLabel('linux')).toBe('在文件夹中显示');
  });

  it('provides English labels for every file context menu action', () => {
    const t: Translate = (key, params) => translate('en-US', key, params);

    expect(t('workspace.fileMenu.openWith')).toBe('Open with');
    expect(t('workspace.fileMenu.copyPath')).toBe('Copy file path');
    expect(workspaceFileRevealLabel('darwin', t)).toBe('Show in Finder');
    expect(t('workspace.fileMenu.addToChat')).toBe('Add to chat');
  });

  it('builds a normalized file mention for add-to-conversation', () => {
    expect(workspaceFileMentionEntry('.\\src\\domain\\agent.ts')).toEqual({
      kind: 'file',
      name: 'agent.ts',
      parent: 'src/domain',
      path: 'src/domain/agent.ts',
    });
  });
});
