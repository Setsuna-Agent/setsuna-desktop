export type ComposerDraftSyncPlan =
  | { type: 'none' }
  | { type: 'adopt' }
  | { type: 'append' | 'replace'; value: string };

/**
 * Slot-mode Sender does not render external `value` changes by itself. Keep
 * internal editor echoes untouched, while turning genuine parent updates into
 * the least destructive editor operation so mention and skill slots survive.
 */
export function createComposerDraftSyncPlan(
  externalDraft: string,
  lastEditorDraft: string,
  currentEditorDraft: string,
): ComposerDraftSyncPlan {
  if (externalDraft === lastEditorDraft) return { type: 'none' };
  if (externalDraft === currentEditorDraft) return { type: 'adopt' };
  if (externalDraft.startsWith(currentEditorDraft)) {
    return { type: 'append', value: externalDraft.slice(currentEditorDraft.length) };
  }
  return { type: 'replace', value: externalDraft };
}
