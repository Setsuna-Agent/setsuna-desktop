import type { RuntimeEvent, RuntimeThread, StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { NotificationInput } from '../contracts/index.js';

type CompletedTurn = Extract<RuntimeEvent, { type: 'turn.completed' }> & { turnId: string };

export function isNotifiableCompletion(event: StoredThreadEvent): event is CompletedTurn {
  return event.type === 'turn.completed' && Boolean(event.turnId)
    && event.payload.taskKind !== 'compact'
    && event.payload.taskKind !== 'user_shell'
    && event.payload.taskKind !== 'subagent';
}

export function completedTurnNotification(event: CompletedTurn, thread: RuntimeThread | null): NotificationInput | null {
  if (!thread || thread.kind === 'side' || thread.parentThreadId) return null;
  const turn = thread.turns?.find((candidate) => candidate.id === event.turnId);
  if (turn?.status !== 'completed') return null;
  // Match the completed turn explicitly: a queued follow-up may already have started by this read.
  const answer = [...thread.messages].reverse().find((message) => (
    message.turnId === event.turnId && message.role === 'assistant'
    && message.phase === 'final_answer' && message.status === 'complete'
    && message.visibility !== 'model' && !message.contextCompaction && !message.planMode
    && message.content.trim()
  ));
  if (!answer) return null;
  return {
    id: `turn-completed:${event.threadId}:${event.turnId}`,
    threadId: event.threadId,
    title: notificationPreview(thread.title, 80) || 'Setsuna',
    body: notificationPreview(answer.content, 160),
    onlyWhenBackground: true,
  };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Preserve the answer text while fitting a compact native banner, without splitting emoji. */
function notificationPreview(value: string, limit: number): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  if (text.length <= limit) return text;
  let preview = '';
  for (const { segment } of graphemes.segment(text)) {
    if (preview.length + segment.length > limit - 1) break;
    preview += segment;
  }
  return `${preview.trimEnd()}…`;
}
