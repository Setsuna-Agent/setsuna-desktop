import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { RuntimeDebugTraceEvent } from '../contracts/index.js';
import type { ConversationDebugRecord } from './conversationDebugGraph.js';

export type ConversationDebugRecordGroup = Readonly<{
  groupKey: string;
  id: string;
  recordGroup: true;
  records: readonly ConversationDebugRecord[];
}>;

export type ConversationDebugRecordListItem =
  | ConversationDebugRecord
  | ConversationDebugRecordGroup;

/**
 * Collapses only consecutive, lossless high-frequency records. Boundaries from
 * lifecycle events stay visible and expanding a row restores every raw record.
 */
export function groupConversationDebugRecords(
  records: readonly ConversationDebugRecord[],
): ConversationDebugRecordListItem[] {
  const items: ConversationDebugRecordListItem[] = [];
  let groupKey: string | null = null;
  let groupedRecords: ConversationDebugRecord[] = [];

  const flush = () => {
    if (!groupedRecords.length) return;
    if (groupedRecords.length === 1 || !groupKey) {
      items.push(...groupedRecords);
    } else {
      items.push(Object.freeze({
        groupKey,
        id: `record-group:${groupedRecords[0]!.id}`,
        recordGroup: true as const,
        records: Object.freeze([...groupedRecords]),
      }));
    }
    groupKey = null;
    groupedRecords = [];
  };

  for (const record of records) {
    const nextGroupKey = conversationDebugRecordGroupKey(record);
    if (!nextGroupKey) {
      flush();
      items.push(record);
      continue;
    }
    if (groupKey !== nextGroupKey) {
      flush();
      groupKey = nextGroupKey;
    }
    groupedRecords.push(record);
  }
  flush();
  return items;
}

export function isConversationDebugRecordGroup(
  item: ConversationDebugRecordListItem,
): item is ConversationDebugRecordGroup {
  return 'recordGroup' in item;
}

function conversationDebugRecordGroupKey(record: ConversationDebugRecord): string | null {
  if (isDebugTrace(record)) {
    return record.kind === 'provider.replay.decision'
      ? `trace:${record.kind}:${record.turnId ?? `thread:${record.threadId}`}`
      : null;
  }
  const relationId = streamingEventRelationId(record);
  return relationId
    ? `event:${record.type}:${record.turnId ?? `thread:${record.threadId}`}:${relationId}`
    : null;
}

function streamingEventRelationId(event: StoredThreadEvent): string | null {
  switch (event.type) {
    case 'message.delta':
      return event.payload.messageId;
    case 'item.delta':
    case 'plan.delta':
    case 'reasoning.summary_delta':
    case 'reasoning.raw_delta':
      return event.payload.itemId;
    case 'tool.output_delta':
      return event.payload.toolCallId;
    default:
      return null;
  }
}

function isDebugTrace(record: ConversationDebugRecord): record is RuntimeDebugTraceEvent {
  return 'kind' in record;
}
