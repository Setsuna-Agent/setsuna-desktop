import type { RuntimeMessage } from '../threads.js';

type TranscriptMessageEntry = { message: RuntimeMessage; sourceIndex: number };

/** Compaction records may be stored at model-window positions. Both transcript
 * grouping and paged operation scopes must use their original timeline anchors. */
export function messagesInTranscriptOrder(messages: RuntimeMessage[]): RuntimeMessage[] {
  if (!messages.some((message) => message.contextCompaction)) return messages;
  const entries = messages.map((message, sourceIndex): TranscriptMessageEntry => ({ message, sourceIndex }));
  const boundaries = entries.filter(({ message }) => Boolean(message.contextCompaction));
  const timeline = entries.filter(({ message }) => !message.contextCompaction);
  boundaries.sort(compareTranscriptBoundaryEntries);
  for (const boundary of boundaries) {
    const anchorId = boundary.message.contextCompaction?.transcriptAfterMessageId;
    const anchorIndex = anchorId ? timeline.findIndex(({ message }) => message.id === anchorId) : -1;
    const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : inferredTranscriptBoundaryIndex(timeline, boundary);
    timeline.splice(insertAt, 0, boundary);
  }
  return timeline.map(({ message }) => message);
}

function compareTranscriptBoundaryEntries(left: TranscriptMessageEntry, right: TranscriptMessageEntry): number {
  const leftTime = Date.parse(left.message.createdAt);
  const rightTime = Date.parse(right.message.createdAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
  return left.sourceIndex - right.sourceIndex;
}

function inferredTranscriptBoundaryIndex(timeline: TranscriptMessageEntry[], boundary: TranscriptMessageEntry): number {
  const boundaryTime = Date.parse(boundary.message.createdAt);
  if (Number.isFinite(boundaryTime)) {
    let insertAfter = -1;
    for (const [index, entry] of timeline.entries()) {
      const entryTime = Date.parse(entry.message.createdAt);
      if (Number.isFinite(entryTime) && entryTime <= boundaryTime) insertAfter = index;
    }
    return insertAfter + 1;
  }
  const sourcePosition = timeline.findIndex((entry) => entry.sourceIndex > boundary.sourceIndex);
  return sourcePosition >= 0 ? sourcePosition : timeline.length;
}
