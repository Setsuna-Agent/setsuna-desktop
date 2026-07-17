export type ComposerDraftSyncPlan =
  | { type: 'none' }
  | { type: 'adopt' }
  | { type: 'append' | 'replace'; value: string };

/**
 * 槽位模式的 Sender 不会自行渲染外部 `value` 变化。保持编辑器内部回显不变，
 * 同时将真正的父级更新转换为破坏性最小的编辑操作，以保留提及和 Skill 槽位。
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
