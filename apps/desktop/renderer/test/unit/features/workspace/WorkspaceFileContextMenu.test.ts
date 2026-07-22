import { describe, expect, it } from 'vitest';
import {
  workspaceFileMentionEntry,
  workspaceFileRevealLabel,
} from '../../../../src/features/workspace/WorkspaceFileContextMenu.js';

describe('workspace file context menu helpers', () => {
  it('uses the platform-native folder label', () => {
    expect(workspaceFileRevealLabel('darwin')).toBe('在访达中显示');
    expect(workspaceFileRevealLabel('win32')).toBe('在文件资源管理器中显示');
    expect(workspaceFileRevealLabel('linux')).toBe('在文件夹中显示');
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
