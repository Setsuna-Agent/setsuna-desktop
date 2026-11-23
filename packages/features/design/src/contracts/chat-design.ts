import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { designOwnerCodec, type DesignConversationOwner } from './design-conversations.js';

export const chatDesignTool = 'chat_design';
/** The containing directory disambiguates same-named drafts in the project picker. */
export type ProjectDesignEntry = DesignConversationOwner & { directory?: string };
export type ChatDesignScope = { projectId?: string; threadId: string };
export type ChatDesignResult = DesignConversationOwner & { revision: string; canvasRequestId?: string; networkAccess?: boolean; action: 'create' | 'open' | 'edit' };

export interface ChatDesignTools {
  definition(writable: boolean, canvasOpen: boolean): RuntimeToolDefinition;
  execute(input: unknown, scope: ChatDesignScope & { turnId: string }, policy: { writable: boolean; networkAccess: boolean }, signal: AbortSignal): Promise<{
    content: string; data?: unknown; containsExternalContext: true;
  }>;
}

export function chatDesignResult(data: unknown): ChatDesignResult | undefined {
  if (!data || typeof data !== 'object' || !('resultKind' in data) || data.resultKind !== 'design.draft'
    || !('resultMajor' in data) || data.resultMajor !== 1 || !('payload' in data)) return;
  const value = data.payload;
  if (!value || typeof value !== 'object' || !('revision' in value) || typeof value.revision !== 'string'
    || !('action' in value) || !(value.action === 'create' || value.action === 'open' || value.action === 'edit')) return;
  try { return { ...designOwnerCodec.parse(value), action: value.action, revision: value.revision,
    ...('canvasRequestId' in value && typeof value.canvasRequestId === 'string' ? { canvasRequestId: value.canvasRequestId } : {}), networkAccess: 'networkAccess' in value && value.networkAccess === true }; } catch { return; }
}

export const listProjectDesigns = defineFeatureOperation({
  id: 'design.project.list', path: '/v1/features/design/project-documents', method: 'GET', idempotency: 'safe', errors: {},
  input: defineRuntimeCodec((value) => {
    if (!value || typeof value !== 'object' || !('projectId' in value) || typeof value.projectId !== 'string' || !value.projectId) throw new Error('Missing project.');
    return { projectId: value.projectId };
  }), output: defineRuntimeCodec<ProjectDesignEntry[]>((value) => {
    if (!Array.isArray(value)) throw new Error('Invalid project design list.');
    return value.map((entry) => {
      const owner = designOwnerCodec.parse(entry);
      return typeof entry.directory === 'string' ? { ...owner, directory: entry.directory } : owner;
    });
  }),
});

export function chatDesignTitle({ ref }: DesignConversationOwner) {
  return (ref.path.split('/').at(-1) ?? ref.path).replace(/\.design\.json$/iu, '');
}

export function designMentionText(owner: DesignConversationOwner) {
  const label = chatDesignTitle(owner).replace(/[[\]\p{Cc}]/gu, ' ').trim().slice(0, 200) || 'Design';
  const params = new URLSearchParams({ id: owner.documentId, path: owner.ref.path });
  if (owner.ref.storageId) params.set('storageId', owner.ref.storageId);
  else {
    if (owner.ref.projectId) params.set('projectId', owner.ref.projectId);
    if (owner.ref.rootId) params.set('rootId', owner.ref.rootId);
  }
  return `[@${label}](design://draft?${params})`;
}

export function designOwnerFromHref(href?: string): DesignConversationOwner | undefined {
  if (!href?.startsWith('design://draft?')) return;
  const { id: documentId, ...ref } = Object.fromEntries(new URLSearchParams(href.slice('design://draft?'.length)));
  try { return designOwnerCodec.parse({ ref, documentId }); } catch { return; }
}

export function parseDesignMentions(content: string) {
  const result: { owner: DesignConversationOwner; start: number; end: number }[] = [];
  for (const match of content.matchAll(/\[@[^\]\r\n]{1,200}\]\(design:\/\/draft\?([^()\s]+)\)/gu)) {
    const owner = designOwnerFromHref('design://draft?' + match[1]);
    if (owner) result.push({ owner, start: match.index, end: match.index + match[0].length });
  }
  return result;
}
