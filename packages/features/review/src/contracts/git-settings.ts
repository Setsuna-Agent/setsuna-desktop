import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { DEFAULT_COMMIT_MESSAGE_PROMPT, commitMessagePromptCodec } from './commit-message-prompt.js';
import { reviewModelSelectionCodec, type ReviewModelSelection } from './model-selection.js';
import type { ReviewModelOption } from './runtime.js';

export const DEFAULT_CONFLICT_RESOLUTION_PROMPT = [
  '请解决当前仓库在拉取或同步后出现的 Git 冲突。',
  '先检查 git status、当前 merge/rebase 状态，以及冲突文件的 base、ours、theirs，理解双方改动的意图后逐个合并。',
  '只修改解决冲突所必需的文件，保留无关的已暂存、未暂存和未跟踪改动；不要直接全部选择 ours 或 theirs。',
  '解决后检查冲突标记并运行与改动相关的定向验证，只暂存已解决的冲突文件。',
  '若正在 rebase，继续 rebase 并处理后续冲突直到结束；若正在 merge，完成本次合并。若只是 autostash 恢复冲突，仅恢复并解决冲突，不额外创建提交，不删除 stash。',
  '不要推送、强制重置、清理工作区或跳过提交。若无法确定正确的合并结果，保留现场并说明需要用户判断的内容。',
  '最后说明处理了哪些冲突、验证结果和剩余事项。',
].join('\n');

export type GitSettings = Readonly<{
  commitMessageModel: ReviewModelSelection;
  commitMessagePrompt: string;
  autoResolveConflicts: boolean;
  conflictResolutionModel: ReviewModelSelection;
  conflictResolutionPrompt: string;
}>;
export type GitSettingsState = Readonly<{ settings: GitSettings; revision: number; availableModels: readonly ReviewModelOption[] }>;
export type GitSettingsUpdate = Readonly<{ settings: GitSettings; expectedRevision: number }>;

export const defaultGitSettings = (): GitSettings => ({
  commitMessageModel: null,
  commitMessagePrompt: DEFAULT_COMMIT_MESSAGE_PROMPT,
  autoResolveConflicts: false,
  conflictResolutionModel: null,
  conflictResolutionPrompt: DEFAULT_CONFLICT_RESOLUTION_PROMPT,
});

export const gitSettingsCodec = defineRuntimeCodec<GitSettings>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Git settings must be an object.');
  const record = value as Record<string, unknown>;
  if (typeof record.autoResolveConflicts !== 'boolean') throw new Error('autoResolveConflicts must be a boolean.');
  return Object.freeze({
    commitMessageModel: reviewModelSelectionCodec.parse(record.commitMessageModel),
    commitMessagePrompt: commitMessagePromptCodec.parse(record.commitMessagePrompt),
    autoResolveConflicts: record.autoResolveConflicts,
    conflictResolutionModel: reviewModelSelectionCodec.parse(record.conflictResolutionModel),
    conflictResolutionPrompt: commitMessagePromptCodec.parse(record.conflictResolutionPrompt),
  });
});
