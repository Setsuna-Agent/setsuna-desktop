import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { parseWorkspaceMentionText } from '../mentions/workspaceMentionParser.js';

/** Draft-only metadata distinguishes a selected file from an unfinished @ query. */
export type WorkspaceDraftReference = { start: number; end: number; entry: WorkspaceEntrySearchItem };

export function normalizeWorkspaceDraftReferences(draft: string, references: unknown): WorkspaceDraftReference[] {
  if (!Array.isArray(references)) return [];
  const valid: WorkspaceDraftReference[] = [];
  for (const reference of references) {
    if (!reference || !Number.isInteger(reference.start) || !Number.isInteger(reference.end)
      || reference.start < 0 || reference.end <= reference.start || reference.end > draft.length) continue;
    const entry = reference.entry as WorkspaceEntrySearchItem | undefined;
    if (!entry || (entry.kind !== 'file' && entry.kind !== 'directory')
      || typeof entry.path !== 'string' || typeof entry.name !== 'string' || typeof entry.parent !== 'string'
      || (entry.absolutePath !== undefined && typeof entry.absolutePath !== 'string')
      || (entry.rootId !== undefined && typeof entry.rootId !== 'string')
      || (entry.rootName !== undefined && typeof entry.rootName !== 'string')) continue;
    const token = draft.slice(reference.start, reference.end);
    const [mention, extra] = parseWorkspaceMentionText(token);
    const path = entry.absolutePath ?? entry.path;
    const expectedPath = entry.kind === 'directory' ? `${path.replace(/\/$/u, '')}/` : path;
    if (extra || mention?.type !== 'mention' || mention.serializedText !== token
      || mention.entryType !== entry.kind || mention.path !== expectedPath) continue;
    valid.push({ start: reference.start, end: reference.end, entry });
  }
  let end = 0;
  return valid.sort((first, second) => first.start - second.start).filter((reference) => {
    if (reference.start < end) return false;
    end = reference.end;
    return true;
  });
}
