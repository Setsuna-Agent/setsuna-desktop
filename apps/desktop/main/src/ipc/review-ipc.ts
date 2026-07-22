import { ipcMain } from 'electron';
import {
  checkoutReviewBranch,
  commitReviewChanges,
  createAndCheckoutReviewBranch,
  discardUnstagedReviewFiles,
  getCommitMessageGenerationSource,
  getDesktopReviewState,
  pushReviewBranch,
  stageReviewFiles,
  unstageReviewFiles,
} from '../review/state.js';
import type { RuntimeHost } from '../runtime/host.js';

export function registerReviewIpc(runtimeHost: RuntimeHost): void {
  const channels = [
    'desktop-review:get-state',
    'desktop-review:discard-unstaged',
    'desktop-review:stage-files',
    'desktop-review:unstage-files',
    'desktop-review:checkout-branch',
    'desktop-review:create-branch',
    'desktop-review:commit',
    'desktop-review:push',
    'desktop-review:generate-commit-message',
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle('desktop-review:get-state', async (_event, input) =>
    getDesktopReviewState(String(input?.workspaceRoot ?? ''), { baseRef: typeof input?.baseRef === 'string' ? input.baseRef : null }),
  );
  ipcMain.handle('desktop-review:discard-unstaged', async (_event, input) =>
    discardUnstagedReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle('desktop-review:stage-files', async (_event, input) =>
    stageReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle('desktop-review:unstage-files', async (_event, input) =>
    unstageReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle('desktop-review:checkout-branch', async (_event, input) =>
    checkoutReviewBranch(String(input?.workspaceRoot ?? ''), String(input?.branchName ?? '')),
  );
  ipcMain.handle('desktop-review:create-branch', async (_event, input) =>
    createAndCheckoutReviewBranch(String(input?.workspaceRoot ?? ''), String(input?.branchName ?? ''), {
      allowUnstaged: Boolean(input?.allowUnstaged),
    }),
  );
  ipcMain.handle('desktop-review:commit', async (_event, input) =>
    commitReviewChanges(String(input?.workspaceRoot ?? ''), normalizeCommitInput(input)),
  );
  ipcMain.handle('desktop-review:push', async (_event, input) => pushReviewBranch(String(input?.workspaceRoot ?? '')));
  ipcMain.handle('desktop-review:generate-commit-message', async (_event, input) => {
    const source = await getCommitMessageGenerationSource(
      String(input?.workspaceRoot ?? ''),
      input?.includeUnstaged !== false,
    );
    const result = await runtimeHost.request<{ message?: unknown }>({
      path: '/v1/git/commit-message/generate',
      method: 'POST',
      body: source,
    });
    return { message: String(result.message ?? '').trim() };
  });
}

function normalizeFilePathList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeCommitInput(value: unknown): { includeUnstaged: boolean; message: string; push: boolean } {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    includeUnstaged: input.includeUnstaged !== false,
    message: String(input.message ?? ''),
    push: Boolean(input.push),
  };
}
