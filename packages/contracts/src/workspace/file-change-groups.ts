import type { RuntimeMessage, RuntimeMessagePage, RuntimeToolRun } from '../threads.js';
import { messagesInTranscriptOrder } from '../threads/transcript-order.js';
import { fileChangeMetadata, fileDiffRecordsFromRun } from './file-change-data.js';
import type { RuntimeFileChangeGroups, RuntimeFileChangeOperation } from './file-change-group-types.js';
export type * from './file-change-group-types.js';

const mutationToolNames = new Set([
  'workspace_write_file', 'apply_patch', 'write_file', 'append_file', 'delete_file', 'edit', 'edit_file',
]);
const operationCache = new WeakMap<RuntimeToolRun, RuntimeFileChangeOperation['run'] | null>();

export function isFileMutationToolName(name: string): boolean { return mutationToolNames.has(name); }

export function messageFileChangeGroupId(message: RuntimeMessage): string | undefined {
  return message.turnId || message.fileChangeGroupId;
}

/** Page the transcript, not the operation scope. Only index visible turns and keep file
 * metadata: fetching a page must never copy hidden diff lines, tool output or undo patches. */
export function projectMessagePageFileChanges(messages: RuntimeMessage[], page: RuntimeMessagePage): RuntimeMessagePage {
  const legacyGroups = inferLegacyFileChangeGroups(messages);
  const projected = page.messages.map((message) => {
    const groupId = legacyGroups.get(message.id);
    return groupId ? { ...message, fileChangeGroupId: groupId } : message;
  });
  const groupIds = new Set(projected.map(messageFileChangeGroupId).filter((id): id is string => Boolean(id)));
  const groups = new Map([...groupIds].map((id) => [id, [] as RuntimeFileChangeGroups[string]]));
  for (const message of messages) {
    if (message.role !== 'assistant' || message.visibility === 'model') continue;
    const groupId = message.turnId || legacyGroups.get(message.id);
    const operations = groupId ? groups.get(groupId) : undefined;
    if (!operations) continue;
    for (const run of message.toolRuns ?? []) {
      const compact = compactOperation(run);
      if (compact) operations.push({ messageId: message.id, run: compact });
    }
  }
  return { ...page, messages: projected, fileChangeGroups: groups.size ? Object.fromEntries(groups) : undefined };
}

/** Legacy runs follow visible user/assistant boundaries. Resolve them against the
 * full timeline before paging; deriving a key from the first message on each page
 * would change the undo scope whenever history is loaded. Never invent a turnId. */
function inferLegacyFileChangeGroups(messages: RuntimeMessage[]): Map<string, string> {
  const groups = new Map<string, string>();
  if (!messages.some((message) => !message.turnId && message.role === 'assistant' && message.visibility !== 'model')) return groups;
  const seenUserTurns = new Set<string>();
  const promptTurns = new Set<string>();
  let lastPrompt: RuntimeMessage | undefined;
  let legacyIds: string[] = [];
  let firstAssistantId: string | undefined;
  let turnId: string | undefined;
  let hasCompaction = false;
  const flush = () => {
    if (firstAssistantId) {
      const groupId = turnId || `legacy:${firstAssistantId}`;
      for (const id of legacyIds) groups.set(id, groupId);
    }
    legacyIds = [];
    firstAssistantId = undefined;
    turnId = undefined;
    hasCompaction = false;
  };
  for (const message of messagesInTranscriptOrder(messages)) {
    if (message.visibility === 'model' || message.role === 'tool') continue;
    if (message.contextCompaction) {
      if (!message.turnId) flush();
      else {
        if (turnId && turnId !== message.turnId) flush();
        turnId = message.turnId;
        hasCompaction = true;
      }
      continue;
    }
    if (message.role === 'system' || message.role === 'developer') {
      const goalExit = message.goalMode?.kind;
      if (message.reviewMode || goalExit === 'complete' || goalExit === 'blocked' || goalExit === 'usageLimited') flush();
      continue;
    }
    if (message.role === 'assistant') {
      if ((firstAssistantId || hasCompaction) && turnId && message.turnId && turnId !== message.turnId) flush();
      firstAssistantId ??= message.id;
      turnId ??= message.turnId;
      if (message.turnId && lastPrompt && (!lastPrompt.turnId || lastPrompt.turnId === message.turnId)) promptTurns.add(message.turnId);
      if (!message.turnId) legacyIds.push(message.id);
      continue;
    }
    const steered = message.turnId && (seenUserTurns.has(message.turnId)
      || (firstAssistantId && (!turnId || message.turnId === turnId)));
    if (message.turnId) seenUserTurns.add(message.turnId);
    if (steered && message.turnId) {
      if (lastPrompt && (!lastPrompt.turnId || lastPrompt.turnId === message.turnId)) promptTurns.add(message.turnId);
      if (promptTurns.has(message.turnId) || (firstAssistantId && (!turnId || message.turnId === turnId))) continue;
    }
    flush();
    lastPrompt = message;
    if (message.turnId) promptTurns.add(message.turnId);
  }
  flush();
  return groups;
}

function compactOperation(run: RuntimeToolRun): RuntimeFileChangeOperation['run'] | null {
  if (run.status !== 'success' || !isFileMutationToolName(run.name)) return null;
  if (operationCache.has(run)) return operationCache.get(run)!;
  const files = fileDiffRecordsFromRun(run).map((file) => ({
    ...fileChangeMetadata(file),
    truncated: Boolean(file.truncated || (Array.isArray(file.lines) && file.lines.length)),
  }));
  const compact: RuntimeFileChangeOperation['run'] | null = files.length ? {
    id: run.id, name: run.name, status: 'success',
    data: { diff: files.length === 1 ? files[0] : { type: 'patch_diff', diffs: files } },
  } : null;
  operationCache.set(run, compact);
  return compact;
}
