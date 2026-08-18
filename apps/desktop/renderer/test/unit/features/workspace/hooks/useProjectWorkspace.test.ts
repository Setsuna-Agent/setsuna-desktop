import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  visibleWorkspaceFilePreview,
  workspaceFileOpenFailureFeedback,
} from '../../../../../src/features/workspace/hooks/useProjectWorkspace.js';
import { translate, type Translate } from '../../../../../src/shared/i18n/I18nProvider.js';

describe('visibleWorkspaceFilePreview', () => {
  const preview: WorkspaceFileRead = {
    projectId: 'temporary_workspace.2026-07-18.thread_a',
    path: 'notes.txt',
    content: 'thread A',
    size: 8,
    truncated: false,
  };

  it('keeps a preview that belongs to the active workspace', () => {
    expect(visibleWorkspaceFilePreview(preview, preview.projectId)).toBe(preview);
  });

  it('synchronously hides a preview from the previous workspace', () => {
    expect(visibleWorkspaceFilePreview(preview, 'temporary_workspace.2026-07-18.thread_b')).toBeNull();
    expect(visibleWorkspaceFilePreview(preview, null)).toBeNull();
  });
});

describe('workspace file open failure feedback', () => {
  const t: Translate = (key, params) => translate('zh-CN', key, params);

  it('warns when a referenced file no longer exists', () => {
    expect(workspaceFileOpenFailureFeedback(
      'src/deleted.ts',
      new Error("ENOENT: no such file or directory, stat '/workspace/src/deleted.ts'"),
      t,
    )).toEqual({
      message: '无法打开 src/deleted.ts：文件已删除或不存在。',
      tone: 'warning',
    });
  });

  it('keeps unrelated read failures as errors', () => {
    expect(workspaceFileOpenFailureFeedback(
      'src/private.ts',
      new Error('Permission denied'),
      t,
    )).toEqual({
      message: '无法打开 src/private.ts：Permission denied',
      tone: 'error',
    });
  });
});
