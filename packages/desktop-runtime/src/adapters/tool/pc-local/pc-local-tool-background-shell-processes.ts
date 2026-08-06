/** Read-only projections for intentionally persisted shell services. */

import { formatPath } from './pc-local-tool-paths.js';
import {
  createShellProcessStore,
  pruneShellProcessStore,
} from './pc-local-tool-shell-process.js';
import type {
  ShellProcessStore,
  ShellSession,
} from './pc-local-tool-shell-process-types.js';

export function listBackgroundShellProcesses(
  store: ShellProcessStore = createShellProcessStore(),
  threadId = '',
) {
  const normalizedThreadId = String(threadId || '').trim();
  if (!normalizedThreadId) return [];
  return activeBackgroundShellProcesses(store)
    .filter((session) => session.threadId === normalizedThreadId)
    .map(backgroundShellProcessSnapshot)
    .sort((left, right) => right.started_at_ms - left.started_at_ms);
}

export function listAllBackgroundShellProcesses(
  store: ShellProcessStore = createShellProcessStore(),
) {
  return activeBackgroundShellProcesses(store)
    .map(backgroundShellProcessSnapshot)
    .sort((left, right) => right.started_at_ms - left.started_at_ms);
}

function activeBackgroundShellProcesses(store: ShellProcessStore): ShellSession[] {
  pruneShellProcessStore(store);
  return [...store.sessions.values()]
    .filter((session) => session.persist && !session.closed);
}

function backgroundShellProcessSnapshot(session: ShellSession) {
  return {
    process_id: session.id,
    thread_id: session.threadId || null,
    turn_id: session.turnId || null,
    tool_call_id: session.toolCallId || null,
    command: session.command,
    directory: formatPath(session.cwd, session.root || session.cwd),
    started_at_ms: session.startedAt,
    expires_at_ms: session.persist ? session.expiresAt : null,
  };
}
