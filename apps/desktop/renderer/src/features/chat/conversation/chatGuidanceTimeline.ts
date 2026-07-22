import type { RuntimeMessage } from '@setsuna-desktop/contracts';

export type GuidanceTimelineEntry<TItem> =
  | { type: 'guidance'; messages: RuntimeMessage[] }
  | { type: 'item'; item: TItem };

export type GuidanceTimelineResult<TItem> = {
  consumedGuidanceIds: Set<string>;
  entries: Array<GuidanceTimelineEntry<TItem>>;
};

/**
 * 将 active turn 里的插话按原始 message 顺序插进工作流条目之间。
 *
 * createAssistantRunTimeline 会把多个 assistant segment 合并成同一个 work block，
 * 所以这里不能只按 block 追加，否则插话后的 assistant 内容会跑到插话上方。
 */
export function interleaveGuidanceByMessageOrder<TItem>({
  consumedGuidanceIds = new Set<string>(),
  getItemMessageId,
  guidanceMessages,
  items,
  messageOrderIds,
}: {
  consumedGuidanceIds?: Set<string>;
  getItemMessageId: (item: TItem) => string | undefined;
  guidanceMessages: RuntimeMessage[];
  items: TItem[];
  messageOrderIds: string[];
}): GuidanceTimelineResult<TItem> {
  if (!guidanceMessages.length || !items.length) {
    return {
      consumedGuidanceIds: new Set(consumedGuidanceIds),
      entries: items.map((item) => ({ type: 'item', item })),
    };
  }
  const orderIndex = new Map(messageOrderIds.map((id, index) => [id, index]));
  const nextConsumedGuidanceIds = new Set(consumedGuidanceIds);
  let pendingGuidance = guidanceMessages
    .filter((message) => !nextConsumedGuidanceIds.has(message.id))
    .slice()
    .sort((left, right) => messageOrder(orderIndex, left.id) - messageOrder(orderIndex, right.id));
  const entries: Array<GuidanceTimelineEntry<TItem>> = [];

  for (const item of items) {
    const itemOrder = messageOrder(orderIndex, getItemMessageId(item));
    const beforeItem = pendingGuidance.filter((message) => messageOrder(orderIndex, message.id) < itemOrder);
    if (beforeItem.length) {
      beforeItem.forEach((message) => nextConsumedGuidanceIds.add(message.id));
      pendingGuidance = pendingGuidance.filter((message) => !nextConsumedGuidanceIds.has(message.id));
      entries.push({ type: 'guidance', messages: beforeItem });
    }
    entries.push({ type: 'item', item });
  }

  return { consumedGuidanceIds: nextConsumedGuidanceIds, entries };
}

function messageOrder(orderIndex: Map<string, number>, id: string | undefined): number {
  if (!id) return Number.MAX_SAFE_INTEGER;
  return orderIndex.get(id) ?? Number.MAX_SAFE_INTEGER;
}
