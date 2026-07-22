import { describe, expect, it, vi } from 'vitest';
import { openSideWorkspaceFileAtRoot } from '../../../../../src/features/chat/mentions/sideWorkspaceFileOpening.js';

describe('openSideWorkspaceFileAtRoot', () => {
  it('preserves the selected editor, isolated root, and line number', async () => {
    const openInWorkspaceApp = vi.fn().mockResolvedValue(true);
    const openWithDefaultApp = vi.fn().mockResolvedValue({ ok: true });

    await expect(openSideWorkspaceFileAtRoot({
      filePath: 'src/main.ts',
      line: 42,
      openInWorkspaceApp,
      openWithDefaultApp,
      selectedWorkspaceApp: { id: 'vscode', label: 'VS Code', icon: 'vscode' },
      workspaceRoot: 'D:\\temp\\2026-07-18\\thread_side',
    })).resolves.toBeNull();

    expect(openInWorkspaceApp).toHaveBeenCalledWith(
      'D:\\temp\\2026-07-18\\thread_side',
      'vscode',
      'src/main.ts',
      42,
    );
    expect(openWithDefaultApp).not.toHaveBeenCalled();
  });

  it('uses the root-confined default opener only when no editor is selected', async () => {
    const openWithDefaultApp = vi.fn().mockResolvedValue({ ok: false, error: 'outside workspace' });

    await expect(openSideWorkspaceFileAtRoot({
      filePath: '../other/file.ts',
      openWithDefaultApp,
      selectedWorkspaceApp: null,
      workspaceRoot: '/temporary/thread_side',
    })).resolves.toBe('outside workspace');

    expect(openWithDefaultApp).toHaveBeenCalledWith('/temporary/thread_side', '../other/file.ts');
  });
});
