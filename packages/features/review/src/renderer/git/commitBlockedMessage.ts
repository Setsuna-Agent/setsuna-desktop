import type { ReviewTranslate } from '../messages.js';

export type CommitPrerequisiteState = Readonly<{
  projectSelected: boolean;
  reviewLoading: boolean;
  gitRepository: boolean;
  busy: boolean;
  committableFileCount: number;
}>;

/** Why a Git action cannot start yet. `null` means the repository state already allows it. */
export function commitPrerequisiteMessage(
  state: CommitPrerequisiteState,
  t: ReviewTranslate,
): string | null {
  if (!state.projectSelected) return t('feature.review.git.commitBlockedNoProject');
  if (state.reviewLoading) return t('feature.review.git.commitBlockedLoading');
  if (!state.gitRepository) return t('feature.review.git.commitBlockedNotRepository');
  if (state.busy) return t('feature.review.git.commitBlockedBusy');
  if (state.committableFileCount === 0) return t('feature.review.git.commitBlockedNoStaged');
  return null;
}

/**
 * Commit entry points also need a draft. Only the commit dialog may replace a blank draft with an
 * AI-generated message, so the sidebar surfaces explain the empty message instead of generating.
 */
export function commitBlockedMessage(
  state: CommitPrerequisiteState & Readonly<{ message: string }>,
  t: ReviewTranslate,
): string | null {
  return commitPrerequisiteMessage(state, t)
    ?? (state.message.trim() ? null : t('feature.review.git.commitBlockedNoMessage'));
}
