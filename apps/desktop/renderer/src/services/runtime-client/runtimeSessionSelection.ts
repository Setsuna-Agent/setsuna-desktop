import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { chatComposerNewThreadTarget, parseChatComposerIdentity, type ChatComposerTargetIdentity } from '../../features/chat/session/chatComposerIdentity.js';
import { readSessionRecord, writeSessionRecord } from '../../shared/preferences/sessionStorage.js';
import { selectInitialThreadSummary } from './runtimeThreadState.js';

export function readInitialChatSelection(
  windowKey: string,
  requestedThreadId: string | null,
  threads: RuntimeThreadSummary[],
  projects: WorkspaceProject[],
  legacyThreadId: string | null,
): { threadId: string | null; projectId?: string | null; draftId?: string | null } {
  if (requestedThreadId) return { threadId: requestedThreadId };
  const saved = parseChatComposerIdentity(readSessionRecord(windowKey, 'selection', 'active'));
  const newThread = saved ? chatComposerNewThreadTarget(saved) : null;
  if (newThread && (!newThread.projectId || projects.some((project) => project.id === newThread.projectId))) {
    return { threadId: null, ...newThread };
  }
  const savedThreadId = saved?.startsWith('thread:') ? saved.slice('thread:'.length) : legacyThreadId;
  return { threadId: selectInitialThreadSummary(threads, savedThreadId)?.id ?? null };
}

export function saveChatSelection(windowKey: string, target: ChatComposerTargetIdentity): void {
  writeSessionRecord(windowKey, 'selection', 'active', target);
}
