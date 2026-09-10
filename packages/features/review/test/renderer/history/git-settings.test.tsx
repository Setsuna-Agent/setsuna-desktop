// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { createNoopReviewRendererService, defaultGitSettings, DEFAULT_COMMIT_MESSAGE_PROMPT, type GitSettingsState, type ReviewRendererService } from '../../../src/contracts/index.js';
import { ReviewRendererProvider } from '../../../src/renderer/context.js';
import { GitChangesMenu } from '../../../src/renderer/history/GitChangesMenu.js';
import { ReviewRendererTestHost } from '../review-renderer-test-host.js';

afterEach(cleanup);
const noop = () => undefined;
const model = { providerId: 'provider', providerName: 'Provider', modelId: 'model', modelName: 'Model', modelCode: 'model-code' };
const initial = (prompt: string, revision: number): GitSettingsState => ({ settings: { ...defaultGitSettings(), commitMessagePrompt: prompt }, revision, availableModels: [model] });

async function openMenu(service: ReviewRendererService) {
  render(
    <ReviewRendererProvider service={service}>
      <ReviewRendererTestHost>
        <GitChangesMenu refs={[]} selectedRef="" currentBranch="main" filterVisible={false} busy={false} onSelectRef={noop} onSelectHead={noop} onToggleFilter={noop} />
      </ReviewRendererTestHost>
    </ReviewRendererProvider>,
  );
  await openSettings();
  return screen.findByRole('textbox', { name: '生成提示词' }) as Promise<HTMLTextAreaElement>;
}
async function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: '更多 Git 操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '设置' }));
}

it('edits shared models and both prompts in one save, exposing conflict settings only when enabled', async () => {
  let persisted = initial('Use the repository style.', 2);
  const update = vi.fn<ReviewRendererService['updateGitSettings']>(async (input) => {
    persisted = { ...persisted, settings: input.settings, revision: input.expectedRevision + 1 };
    return persisted;
  });
  const input = await openMenu({ ...createNoopReviewRendererService(), available: true, readGitSettings: async () => persisted, updateGitSettings: update });
  await waitFor(() => expect(input.value).toBe(persisted.settings.commitMessagePrompt));
  expect(screen.queryByRole('combobox', { name: 'Git 冲突解决' })).toBeNull();
  fireEvent.change(input, { target: { value: 'Use Chinese subjects.\nExplain the changes in the body.' } });
  const reference = JSON.stringify({ providerId: model.providerId, modelId: model.modelId });
  const option = JSON.stringify([model.providerId, model.modelId]);
  fireEvent.change(screen.getByRole('combobox', { name: '提交消息生成' }), { target: { value: option } });
  fireEvent.click(screen.getByRole('checkbox', { name: /^自动解决冲突/ }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Git 冲突解决' }), { target: { value: option } });
  fireEvent.change(screen.getByRole('textbox', { name: '解决冲突提示词' }), { target: { value: 'Inspect both sides, resolve conflicts, and verify.' } });
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(update).toHaveBeenCalledWith({ expectedRevision: 2, settings: {
    autoResolveConflicts: true, commitMessageModel: JSON.parse(reference), conflictResolutionModel: JSON.parse(reference),
    commitMessagePrompt: 'Use Chinese subjects.\nExplain the changes in the body.', conflictResolutionPrompt: 'Inspect both sides, resolve conflicts, and verify.',
  } }, expect.anything());

  await openSettings();
  const reopened = await screen.findByRole('textbox', { name: '生成提示词' }) as HTMLTextAreaElement;
  await waitFor(() => expect(reopened.value).toBe(persisted.settings.commitMessagePrompt));
  fireEvent.click(screen.getAllByRole('button', { name: '恢复默认' })[0]);
  expect(reopened.value).toBe(DEFAULT_COMMIT_MESSAGE_PROMPT);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(update).toHaveBeenCalledTimes(1);
  expect(persisted.settings.commitMessagePrompt).not.toBe(DEFAULT_COMMIT_MESSAGE_PROMPT);
});

it('preserves edits on a revision conflict and reloads explicitly before saving again', async () => {
  const read = vi.fn<ReviewRendererService['readGitSettings']>().mockResolvedValueOnce(initial('Original prompt', 1)).mockResolvedValueOnce(initial('Changed elsewhere', 2));
  const update = vi.fn<ReviewRendererService['updateGitSettings']>().mockRejectedValueOnce(new FeatureOperationFailure({ code: 'REVISION_CONFLICT', message: 'Changed', retryable: true }));
  const input = await openMenu({ ...createNoopReviewRendererService(), available: true, readGitSettings: read, updateGitSettings: update });
  await waitFor(() => expect(input.value).toBe('Original prompt'));
  fireEvent.change(input, { target: { value: 'Local edits' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('alert');
  expect(input.value).toBe('Local edits');
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(input.value).toBe('Changed elsewhere'));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(update).toHaveBeenCalledTimes(1);
});
