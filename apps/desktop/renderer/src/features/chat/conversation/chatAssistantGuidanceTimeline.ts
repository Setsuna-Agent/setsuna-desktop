import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { AssistantRunTimelineBlock, AssistantWorkItem } from './chatAssistantTimeline.js';
import { interleaveGuidanceByMessageOrder, type GuidanceTimelineEntry } from './chatGuidanceTimeline.js';

export type AssistantWorkTimelineBlock = Extract<AssistantRunTimelineBlock, { type: 'work' }>;
export type AssistantNonWorkTimelineBlock = Exclude<AssistantRunTimelineBlock, { type: 'work' }>;

export type AssistantWorkHistoryPlanEntry =
  | { type: 'guidance'; id: string; messages: RuntimeMessage[] }
  | { type: 'workItem'; item: AssistantWorkItem };

export type AssistantGuidanceTimelinePlanNode =
  | { type: 'block'; block: AssistantNonWorkTimelineBlock; guidanceAfter: RuntimeMessage[] }
  | {
      type: 'workHistory';
      active: boolean;
      blocks: AssistantWorkTimelineBlock[];
      entries: AssistantWorkHistoryPlanEntry[];
      hasFollowingContent: boolean;
    };

export type AssistantGuidanceTimelinePlan = {
  nodes: AssistantGuidanceTimelinePlanNode[];
  placeholderGuidance: RuntimeMessage[];
};

export function createAssistantGuidanceTimelinePlan({
  blocks,
  guidanceMessages,
  messageOrderIds,
  turnActive,
}: {
  blocks: AssistantRunTimelineBlock[];
  guidanceMessages: RuntimeMessage[];
  messageOrderIds: string[];
  turnActive: boolean;
}): AssistantGuidanceTimelinePlan {
  const blockIndexById = new Map(blocks.map((block, index) => [block.id, index]));
  const guidanceByBlockIndex = groupGuidanceByPrecedingBlock(blocks, guidanceMessages, messageOrderIds);
  const firstWorkBlockIndex = blocks.findIndex(isAssistantWorkBlock);
  const nodes: AssistantGuidanceTimelinePlanNode[] = [];
  let consumedGuidanceIds = new Set<string>();
  let blockIndex = 0;

  while (blockIndex < blocks.length) {
    const block = blocks[blockIndex];
    if (!block) break;
    if (block.type === 'work') {
      const workBlocks: AssistantWorkTimelineBlock[] = [];
      while (blocks[blockIndex]?.type === 'work') {
        workBlocks.push(blocks[blockIndex] as AssistantWorkTimelineBlock);
        blockIndex += 1;
      }
      const hasFollowingContent = blocks.slice(blockIndex).some(isVisibleContentBlock);
      const result = createWorkHistoryPlan({
        blockIndexById,
        blocks: workBlocks,
        consumedGuidanceIds,
        guidanceByBlockIndex,
        guidanceMessages,
        hasFollowingContent,
        messageOrderIds,
        turnActive,
      });
      consumedGuidanceIds = result.consumedGuidanceIds;
      nodes.push(result.plan);
      continue;
    }

    const guidanceAfter = withoutConsumedGuidance(guidanceByBlockIndex.get(blockIndex) ?? [], consumedGuidanceIds);
    consumeGuidance(consumedGuidanceIds, guidanceAfter);
    nodes.push({
      type: 'block',
      block,
      guidanceAfter,
    });
    blockIndex += 1;
  }

  return {
    nodes,
    placeholderGuidance: firstWorkBlockIndex < 0 ? (guidanceByBlockIndex.get(-1) ?? []) : [],
  };
}

function createWorkHistoryPlan({
  blockIndexById,
  blocks,
  consumedGuidanceIds: initialConsumedGuidanceIds,
  guidanceByBlockIndex,
  guidanceMessages,
  hasFollowingContent,
  messageOrderIds,
  turnActive,
}: {
  blockIndexById: Map<string, number>;
  blocks: AssistantWorkTimelineBlock[];
  consumedGuidanceIds: Set<string>;
  guidanceByBlockIndex: Map<number, RuntimeMessage[]>;
  guidanceMessages: RuntimeMessage[];
  hasFollowingContent: boolean;
  messageOrderIds: string[];
  turnActive: boolean;
}): {
  consumedGuidanceIds: Set<string>;
  plan: Extract<AssistantGuidanceTimelinePlanNode, { type: 'workHistory' }>;
} {
  const entries: AssistantWorkHistoryPlanEntry[] = [];
  let consumedGuidanceIds = new Set(initialConsumedGuidanceIds);

  for (const block of blocks) {
    const interleaved = interleaveGuidanceByMessageOrder({
      consumedGuidanceIds,
      getItemMessageId: assistantWorkItemMessageId,
      guidanceMessages,
      items: block.items,
      messageOrderIds,
    });
    consumedGuidanceIds = interleaved.consumedGuidanceIds;
    entries.push(...interleaved.entries.map(workHistoryPlanEntry));

    const originalBlockIndex = blockIndexById.get(block.id) ?? -1;
    const inlineGuidanceMessages = withoutConsumedGuidance(guidanceByBlockIndex.get(originalBlockIndex) ?? [], consumedGuidanceIds);
    if (inlineGuidanceMessages.length) {
      entries.push(guidancePlanEntry(`${block.id}:guidance-inline`, inlineGuidanceMessages));
      consumeGuidance(consumedGuidanceIds, inlineGuidanceMessages);
    }
  }

  const beforeFirstGuidanceMessages = withoutConsumedGuidance(guidanceByBlockIndex.get(-1) ?? [], consumedGuidanceIds);
  if (beforeFirstGuidanceMessages.length) {
    // steer 消息可能在下一个助手片段创建前到达。将它们保留在当前工作面板内，
    // 不要提升到轮次标题上方。
    entries.unshift(guidancePlanEntry('active-guidance-before-first-inline', beforeFirstGuidanceMessages));
    consumeGuidance(consumedGuidanceIds, beforeFirstGuidanceMessages);
  }
  return {
    consumedGuidanceIds,
    plan: {
      type: 'workHistory',
      active: turnActive,
      blocks,
      entries,
      hasFollowingContent,
    },
  };
}

function workHistoryPlanEntry(
  entry: GuidanceTimelineEntry<AssistantWorkItem>,
): AssistantWorkHistoryPlanEntry {
  if (entry.type === 'guidance') return guidancePlanEntry(`guidance-before-${entry.messages.map((message) => message.id).join('-')}`, entry.messages);
  return {
    type: 'workItem',
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
  if (item.type === 'contextCompaction') return item.message?.id;
  if (item.type === 'thinking') return item.segment.segment.id;
  if (item.type === 'toolRuns') return item.segment.id;
  return undefined;
}

function withoutConsumedGuidance(messages: RuntimeMessage[], consumedIds: Set<string>): RuntimeMessage[] {
  return messages.filter((message) => !consumedIds.has(message.id));
}

function consumeGuidance(consumedIds: Set<string>, messages: RuntimeMessage[]): void {
  messages.forEach((message) => consumedIds.add(message.id));
}

function isAssistantWorkBlock(block: AssistantRunTimelineBlock): block is AssistantWorkTimelineBlock {
  return block.type === 'work';
}

function isVisibleContentBlock(block: AssistantRunTimelineBlock): boolean {
  return block.type === 'content' && Boolean(block.content.trim());
}
