import { describe, expect, it } from 'vitest';
import {
  workspaceFileRevealLabel,
} from '../../../../src/features/workspace/WorkspaceFileContextMenu.js';
import {
  workspaceDirectoryMentionEntry,
  workspaceFileMentionEntry,
} from '../../../../src/features/workspace/workspaceFileMention.js';
import { translate, type Translate } from '../../../../src/shared/i18n/I18nProvider.js';

describe('workspace file context menu helpers', () => {
  it('uses the platform-native folder label', () => {
    expect(workspaceFileRevealLabel('darwin')).toBe('在访达中显示');
    expect(workspaceFileRevealLabel('win32')).toBe('在文件资源管理器中显示');
    expect(workspaceFileRevealLabel('linux')).toBe('在文件夹中显示');
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
