import type { RuntimeEditorSelection } from '@setsuna-desktop/contracts';
import { readDesignDocument, type DesignDocumentRef } from './operations.js';

/** Stored in the message itself so queued turns and restored drafts keep the picked IDs. */
export type DesignSelectionReference = Readonly<{
  documentId: string;
  /** Main chat can address more than one draft, including copies with the same document ID. */
  ref?: DesignDocumentRef;
  boards: readonly string[];
  ids: readonly string[];
  label: string;
}>;

export function designSelectionMentionText(reference: DesignSelectionReference): string {
  const query = new URLSearchParams({ document: reference.documentId });
  if (reference.ref) {
    for (const [key, value] of Object.entries(reference.ref)) {
      if (value !== undefined) query.set(key, value);
    }
  }
  for (const board of reference.boards) query.append('board', board);
  for (const id of reference.ids) query.append('layer', id);
  const label = reference.label.replace(/[[\]\p{Cc}]/gu, ' ').trim().slice(0, 200) || '@';
  return `[@${label}](design-selection://canvas?${query})`;
}

export function parseDesignSelectionMentions(content: string) {
  const mentions: { reference: DesignSelectionReference; start: number; end: number }[] = [];
  for (const match of content.matchAll(/\[@([^\]\r\n]{1,200})\]\(design-selection:\/\/canvas\?([^()\s]+)\)/gu)) {
    const query = new URLSearchParams(match[2]);
    const documentId = query.get('document');
    const ids = query.getAll('layer');
    if (!documentId || !ids.length || ids.some((id) => !id)) continue;
    let ref: DesignDocumentRef | undefined;
    if (query.has('path')) {
      try { ref = readDesignDocument.input.parse(Object.fromEntries(query)); } catch { continue; }
    }
    mentions.push({ reference: { documentId, ...(ref && { ref }), ids, boards: query.getAll('board'), label: match[1] },
      start: match.index, end: match.index + match[0].length });
  }
  return mentions;
}

export function resolveDesignInputSelection(content: string, snapshot?: RuntimeEditorSelection) {
  const mentions = parseDesignSelectionMentions(content);
  const documentId = snapshot?.documentId ?? mentions[0]?.reference.documentId;
  if (!documentId) return { status: 'missing' } as const;
  if (mentions.some(({ reference }) => reference.documentId !== documentId)) return { status: 'conflict' } as const;
  const selection = snapshot ?? { documentId, ids: [...new Set(mentions.flatMap(({ reference }) => reference.ids))] };
  return { status: 'resolved', selection } as const;
}
