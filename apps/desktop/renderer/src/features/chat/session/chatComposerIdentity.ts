const globalNewThreadSlot = 'global';

export type ChatComposerTargetIdentity = `thread:${string}` | `new-thread-slot:${string}` | `new-thread-draft:${string}`;

export function chatComposerTargetIdentity(
  threadId: string | null | undefined,
  projectId: string | null | undefined,
  draftId?: string | null,
): ChatComposerTargetIdentity {
  return threadId ? `thread:${threadId}` : draftId
    ? `new-thread-draft:${draftId}:${encodeURIComponent(projectId ?? '')}`
    : `new-thread-slot:${projectId || globalNewThreadSlot}`;
}

export function chatComposerNewThreadTarget(identity: ChatComposerTargetIdentity): { projectId: string | null; draftId: string | null } | null {
  if (identity.startsWith('thread:')) return null;
  if (identity.startsWith('new-thread-draft:')) {
    const [draftId, projectId] = identity.slice('new-thread-draft:'.length).split(':');
    return { draftId, projectId: projectId ? decodeURIComponent(projectId) : null };
  }
  const projectId = identity.slice('new-thread-slot:'.length);
  return { projectId: projectId === globalNewThreadSlot ? null : projectId, draftId: null };
}

export function parseChatComposerIdentity(value: unknown): ChatComposerTargetIdentity | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  if (/^thread:.+$/u.test(value) || /^new-thread-slot:.+$/u.test(value)) return value as ChatComposerTargetIdentity;
  if (!/^new-thread-draft:[^:]+:[^:]*$/u.test(value)) return null;
  try {
    chatComposerNewThreadTarget(value as ChatComposerTargetIdentity);
    return value as ChatComposerTargetIdentity;
  } catch { return null; }
}
