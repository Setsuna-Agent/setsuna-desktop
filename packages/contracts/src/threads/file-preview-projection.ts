import type { StoredThreadEvent } from '../events.js';
import type { RuntimeMessage, RuntimeThread } from '../threads.js';
import { limitTurnDiff, projectFileToolData, projectFileToolPreview, type FilePreviewProjectionMode } from '../workspace/file-diff-preview.js';

export function projectMessageFilePreviews(message: RuntimeMessage, mode: FilePreviewProjectionMode = 'display'): RuntimeMessage {
  if (!message.toolRuns?.length) return message;
  let changed = false;
  const toolRuns = message.toolRuns.map((run) => {
    const data = projectFileToolData(run.data, mode);
    const resultPreview = projectFileToolPreview(run.resultPreview, data, mode);
    if (data === run.data && resultPreview === run.resultPreview) return run;
    changed = true;
    return { ...run, data, resultPreview };
  });
  return changed ? { ...message, toolRuns } : message;
}

/** Preserve per-file previews and authoritative patches in storage; bound desktop batches. */
export function projectThreadFilePreviews(thread: RuntimeThread, mode: FilePreviewProjectionMode = 'display'): RuntimeThread {
  const messages = thread.messages.map((message) => projectMessageFilePreviews(message, mode));
  const turns = thread.turns?.map((turn) => {
    const diff = turn.diff === undefined ? undefined : limitTurnDiff(turn.diff);
    return diff === turn.diff ? turn : { ...turn, diff };
  });
  return messages.every((message, index) => message === thread.messages[index])
    && turns?.every((turn, index) => turn === thread.turns?.[index]) !== false
    ? thread : { ...thread, messages, turns };
}

/** Raw events remain replayable on disk. Live delivery and replay use the same display projection. */
export function projectEventFilePreviews(event: StoredThreadEvent): StoredThreadEvent {
  switch (event.type) {
    case 'tool.completed': {
      const data = projectFileToolData(event.payload.data);
      const resultPreview = projectFileToolPreview(event.payload.resultPreview, data);
      return { ...event, payload: { ...event.payload, data, resultPreview } };
    }
    case 'tool.started':
      return { ...event, payload: { ...event.payload, resultPreview: projectFileToolPreview(event.payload.resultPreview) } };
    case 'tool.preview':
      return { ...event, payload: { ...event.payload, resultPreview: projectFileToolPreview(event.payload.resultPreview) } };
    case 'message.created':
      return { ...event, payload: { ...event.payload, message: projectMessageFilePreviews(event.payload.message) } };
    case 'thread.context_compacted':
      return { ...event, payload: { ...event.payload, messages: event.payload.messages.map((message) => projectMessageFilePreviews(message)) } };
    case 'turn.diff':
      return { ...event, payload: { unifiedDiff: limitTurnDiff(event.payload.unifiedDiff) } };
    default:
      return event;
  }
}
