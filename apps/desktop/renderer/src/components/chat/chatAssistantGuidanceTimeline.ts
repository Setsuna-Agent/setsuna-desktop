import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { AssistantRunTimelineBlock, AssistantWorkItem } from './chatAssistantTimeline.js';
import { interleaveGuidanceByMessageOrder, type GuidanceTimelineEntry } from './chatGuidanceTimeline.js';

export type AssistantWorkTimelineBlock = Extract<AssistantRunTimelineBlock, { type: 'work' }>;
export type AssistantNonWorkTimelineBlock = Exclude<AssistantRunTimelineBlock, { type: 'work' }>;

export type AssistantWorkHistoryPlanEntry =
  | { type: 'guidance'; id: string; messages: RuntimeMessage[] }
  | { type: 'workItem'; blockActive: boolean; item: AssistantWorkItem };

export type AssistantGuidanceTimelinePlanNode =
  | { type: 'block'; block: AssistantNonWorkTimelineBlock; guidanceAfter: RuntimeMessage[] }
  | { type: 'workHistory'; active: boolean; blocks: AssistantWorkTimelineBlock[]; entries: AssistantWorkHistoryPlanEntry[] };

export type AssistantGuidanceTimelinePlan = {
  hasFollowingContent: boolean;
  nodes: AssistantGuidanceTimelinePlanNode[];
  placeholderGuidance: RuntimeMessage[];
};

export function createAssistantGuidanceTimelinePlan({
  active,
  blocks,
  guidanceMessages,
  messageOrderIds,
  workHistoryActive,
}: {
  active: boolean;
  blocks: AssistantRunTimelineBlock[];
  guidanceMessages: RuntimeMessage[];
  messageOrderIds: string[];
  workHistoryActive: boolean;
}): AssistantGuidanceTimelinePlan {
  const firstWorkBlockIndex = blocks.findIndex((block) => block.type === 'work');
  const hasWorkBlock = firstWorkBlockIndex >= 0;
  const blockIndexById = new Map(blocks.map((block, index) => [block.id, index]));
  const guidanceByBlockIndex = active ? groupGuidanceByPrecedingBlock(blocks, guidanceMessages, messageOrderIds) : new Map<number, RuntimeMessage[]>();
  const hasFollowingContent = blocks.some((block) => block.type === 'content' && block.content.trim());
  const workBlocks = blocks.filter(isAssistantWorkBlock);
  const workHistory = workBlocks.length
    ? createWorkHistoryPlan({
        active,
        blockIndexById,
        blocks: workBlocks,
        collapsedGuidanceMessages: active ? [] : guidanceMessages,
        guidanceByBlockIndex,
        guidanceMessages,
        messageOrderIds,
        workHistoryActive,
      })
    : null;
  const nodes: AssistantGuidanceTimelinePlanNode[] = [];

  blocks.forEach((block, index) => {
    if (block.type === 'work') {
      if (index === firstWorkBlockIndex && workHistory) nodes.push(workHistory);
      return;
    }
    nodes.push({
      type: 'block',
      block,
      guidanceAfter: active ? (guidanceByBlockIndex.get(index) ?? []) : [],
    });
  });

  return {
    hasFollowingContent,
    nodes,
    placeholderGuidance: active && !hasWorkBlock ? (guidanceByBlockIndex.get(-1) ?? []) : [],
  };
}

function createWorkHistoryPlan({
  active,
  blockIndexById,
  blocks,
  collapsedGuidanceMessages,
  guidanceByBlockIndex,
  guidanceMessages,
  messageOrderIds,
  workHistoryActive,
}: {
  active: boolean;
  blockIndexById: Map<string, number>;
  blocks: AssistantWorkTimelineBlock[];
  collapsedGuidanceMessages: RuntimeMessage[];
  guidanceByBlockIndex: Map<number, RuntimeMessage[]>;
  guidanceMessages: RuntimeMessage[];
  messageOrderIds: string[];
  workHistoryActive: boolean;
}): Extract<AssistantGuidanceTimelinePlanNode, { type: 'workHistory' }> {
  const entries: AssistantWorkHistoryPlanEntry[] = [];
  let consumedGuidanceIds = new Set<string>();

  for (const block of blocks) {
    const interleaved = active
      ? interleaveGuidanceByMessageOrder({
          consumedGuidanceIds,
          getItemMessageId: assistantWorkItemMessageId,
          guidanceMessages,
          items: block.items,
          messageOrderIds,
        })
      : {
          consumedGuidanceIds,
          entries: block.items.map((item): GuidanceTimelineEntry<AssistantWorkItem> => ({ type: 'item', item })),
        };
    consumedGuidanceIds = interleaved.consumedGuidanceIds;
    entries.push(...interleaved.entries.map((entry) => workHistoryPlanEntry(block, entry)));

    const originalBlockIndex = blockIndexById.get(block.id) ?? -1;
    const inlineGuidanceMessages = active ? withoutConsumedGuidance(guidanceByBlockIndex.get(originalBlockIndex) ?? [], consumedGuidanceIds) : [];
    if (inlineGuidanceMessages.length) entries.push(guidancePlanEntry(`${block.id}:guidance-inline`, inlineGuidanceMessages));
  }

  const beforeFirstGuidanceMessages = active ? withoutConsumedGuidance(guidanceByBlockIndex.get(-1) ?? [], consumedGuidanceIds) : [];
  if (beforeFirstGuidanceMessages.length) {
    // Steer messages can arrive before the next assistant segment is created.
    // Keep them inside the active work panel instead of lifting them above the turn header.
    entries.push(guidancePlanEntry('active-guidance-before-first-inline', beforeFirstGuidanceMessages));
  }
  if (!active && collapsedGuidanceMessages.length) {
    entries.push(guidancePlanEntry('completed-guidance-inline', collapsedGuidanceMessages));
  }

  return {
    type: 'workHistory',
    active: blocks.some((block) => block.active) || workHistoryActive,
    blocks,
    entries,
  };
}

function workHistoryPlanEntry(
  block: AssistantWorkTimelineBlock,
  entry: GuidanceTimelineEntry<AssistantWorkItem>,
): AssistantWorkHistoryPlanEntry {
  if (entry.type === 'guidance') return guidancePlanEntry(`guidance-before-${entry.messages.map((message) => message.id).join('-')}`, entry.messages);
  return {
    type: 'workItem',
    blockActive: block.active,
    item: entry.item,
  };
}

function guidancePlanEntry(id: string, messages: RuntimeMessage[]): AssistantWorkHistoryPlanEntry {
  return {
    type: 'guidance',
    id,
    messages,
  };
}

function groupGuidanceByPrecedingBlock(
  blocks: AssistantRunTimelineBlock[],
  guidanceMessages: RuntimeMessage[],
  messageOrderIds: string[],
): Map<number, RuntimeMessage[]> {
  const orderIndex = new Map(messageOrderIds.map((id, index) => [id, index]));
  const blockOrderIndexes = blocks.map((block) => blockOrderIds(block)
    .map((id) => orderIndex.get(id))
    .filter((index): index is number => index !== undefined));
  const grouped = new Map<number, RuntimeMessage[]>();
  for (const message of guidanceMessages) {
    const guidanceIndex = orderIndex.get(message.id) ?? Number.MAX_SAFE_INTEGER;
    let precedingBlockIndex = -1;
    blockOrderIndexes.forEach((indexes, blockIndex) => {
      const maxIndex = indexes.length ? Math.max(...indexes) : -1;
      if (maxIndex >= 0 && maxIndex < guidanceIndex) precedingBlockIndex = blockIndex;
    });
    const messages = grouped.get(precedingBlockIndex) ?? [];
    messages.push(message);
    grouped.set(precedingBlockIndex, messages);
  }
  return grouped;
}

function blockOrderIds(block: AssistantRunTimelineBlock): string[] {
  if (block.type === 'work') return block.segments.map((segment) => segment.id);
  return [block.segment.id];
}

function assistantWorkItemMessageId(item: AssistantWorkItem): string | undefined {
  if (item.type === 'content') return item.segment.segment.id;
  if (item.type === 'thinking') return item.segment.segment.id;
  return item.segment.id;
}

function withoutConsumedGuidance(messages: RuntimeMessage[], consumedIds: Set<string>): RuntimeMessage[] {
  return messages.filter((message) => !consumedIds.has(message.id));
}

function isAssistantWorkBlock(block: AssistantRunTimelineBlock): block is AssistantWorkTimelineBlock {
  return block.type === 'work';
}
