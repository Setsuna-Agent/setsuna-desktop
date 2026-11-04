import type { RuntimeSkillReference } from '@setsuna-desktop/contracts';
import type { WorkspaceDraftReference } from '../session/chatDraftReferences.js';

type ComposerDraftReferences = {
  skillReferences: RuntimeSkillReference[];
  workspaceReferences: WorkspaceDraftReference[];
};

/** Text equality alone cannot distinguish a selected reference from ordinary text. */
export function sameComposerDraftReferences(first: ComposerDraftReferences, second: ComposerDraftReferences): boolean {
  return first.skillReferences.length === second.skillReferences.length
    && first.skillReferences.every((reference, index) => {
      const other = second.skillReferences[index];
      return reference.skillId === other.skillId && reference.start === other.start && reference.end === other.end;
    })
    && first.workspaceReferences.length === second.workspaceReferences.length
    && first.workspaceReferences.every((reference, index) => {
      const other = second.workspaceReferences[index];
      return reference.entry === other.entry && reference.start === other.start && reference.end === other.end;
    });
}

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
  previousExternalDraft: string,
  lastEditorDraft: string,
  currentEditorDraft: string,
  referencesChanged = false,
): ComposerDraftSyncPlan {
  // Replace metadata-only updates in the currently mounted editor, including
  // retrieval responses delivered through an earlier composer's session callback.
  if (referencesChanged && (externalDraft !== previousExternalDraft || externalDraft === currentEditorDraft)) {
    return { type: 'replace', value: externalDraft };
  }
  // Effects can be replayed before an imperative Sender insertion has propagated
  // through onChange. An unchanged parent value is not an external reset.
  if (externalDraft === previousExternalDraft) return { type: 'none' };
  if (externalDraft === lastEditorDraft) return { type: 'none' };
  if (externalDraft === currentEditorDraft) return { type: 'adopt' };
  if (externalDraft.startsWith(currentEditorDraft)) {
    return { type: 'append', value: externalDraft.slice(currentEditorDraft.length) };
  }
  return { type: 'replace', value: externalDraft };
}
