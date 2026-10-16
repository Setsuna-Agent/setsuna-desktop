import type { RuntimeSkillReference } from '@setsuna-desktop/contracts';
import { readSessionRecord } from '../../../shared/preferences/sessionStorage.js';
import type { ChatComposerTargetIdentity } from './chatComposerIdentity.js';
import { normalizeWorkspaceDraftReferences, type WorkspaceDraftReference } from './chatDraftReferences.js';

export type SavedChatDraft = { draft: string; skillReferences: RuntimeSkillReference[]; workspaceReferences: WorkspaceDraftReference[] };

export function readChatDraft(windowKey: string | null, identity: ChatComposerTargetIdentity): SavedChatDraft {
  const value = readSessionRecord(windowKey, 'draft', identity) as Partial<SavedChatDraft> | null;
  if (!value || typeof value.draft !== 'string') return { draft: '', skillReferences: [], workspaceReferences: [] };
  const draft = value.draft;
  const skillReferences = Array.isArray(value.skillReferences) ? value.skillReferences.filter((reference) =>
    reference && typeof reference.skillId === 'string' && reference.skillId.length > 0
    && Number.isInteger(reference.start) && Number.isInteger(reference.end)
    && reference.start >= 0 && reference.end > reference.start && reference.end <= draft.length,
  ).map(({ skillId, start, end }) => ({ skillId, start, end })) : [];
  return { draft, skillReferences, workspaceReferences: normalizeWorkspaceDraftReferences(draft, value.workspaceReferences) };
}
