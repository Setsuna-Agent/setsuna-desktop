import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { RuntimePluginUse } from '../plugin-usage/runtimePluginUsage.js';
import { isTranscriptHiddenRuntimeToolRun } from '../tool-runs/runtimeToolRunVisibility.js';
import { isActiveRuntimeToolRun } from '../tool-runs/runtimeToolRunState.js';
import { hasRenderableThinkingContent, splitThinkingContent } from './chatThinkingContent.js';

export type AssistantRunTimelineBlock =
  | {
      type: 'work';
      id: string;
      segments: RuntimeMessage[];
      toolRuns: NonNullable<RuntimeMessage['toolRuns']>;
      active: boolean;
      items: AssistantWorkItem[];
      contentSegments: AssistantWorkContentSegment[];
      thinkingSegments: AssistantWorkThinkingSegment[];
    }
  | { type: 'content'; id: string; segment: RuntimeMessage; content: string }
  | { type: 'loading'; id: string; segment: RuntimeMessage }
  | { type: 'error'; id: string; segment: RuntimeMessage };

export type AssistantWorkContentSegment = {
  id: string;
  segment: RuntimeMessage;
  content: string;
};

export type AssistantWorkThinkingSegment = {
  id: string;
  segment: RuntimeMessage;
  content: string;
  active: boolean;
};

export type AssistantWorkItem =
  | { type: 'content'; segment: AssistantWorkContentSegment }
  | { type: 'contextCompaction'; active: boolean; id: string; message?: RuntimeMessage }
  | { type: 'thinking'; segment: AssistantWorkThinkingSegment }
  | { type: 'pluginUses'; id: string; plugins: RuntimePluginUse[] }
  | { type: 'toolRuns'; id: string; segment: RuntimeMessage; toolRuns: NonNullable<RuntimeMessage['toolRuns']> };

export function createAssistantRunTimeline(
  segments: RuntimeMessage[],
  pluginUses: RuntimePluginUse[] = [],
  options: {
    contextCompactionActive?: boolean;
    contextCompactions?: RuntimeMessage[];
    messageOrderIds?: string[];
    showThinkingInTranscript?: boolean;
  } = {},
): AssistantRunTimelineBlock[] {
  const parsedSegments = segments.map((segment) => parseAssistantSegment(
    segment,
    options.showThinkingInTranscript === true,
  ));
  const finalStartIndex = assistantFinalStartIndex(parsedSegments);
  const finalStarted = finalStartIndex >= 0;
  const blocks: AssistantRunTimelineBlock[] = [];
  let workBlock: {
    id: string;
    contentSegments: AssistantWorkContentSegment[];
    items: AssistantWorkItem[];
    segments: RuntimeMessage[];
    segmentIds: Set<string>;
    toolRuns: NonNullable<RuntimeMessage['toolRuns']>;
    thinkingSegments: AssistantWorkThinkingSegment[];
  } | null = null;

  const appendWork = (
    segment: RuntimeMessage,
    input: {
      contentSegments?: AssistantWorkContentSegment[];
      items?: AssistantWorkItem[];
      thinkingSegments?: AssistantWorkThinkingSegment[];
      toolRuns?: NonNullable<RuntimeMessage['toolRuns']>;
    },
  ) => {
    if (!workBlock) {
      workBlock = {
        id: `${segment.id}:work`,
        contentSegments: [],
        items: [],
        segments: [],
        segmentIds: new Set<string>(),
        toolRuns: [],
        thinkingSegments: [],
      };
    }
    addWorkSegment(workBlock.segments, workBlock.segmentIds, segment);
    workBlock.contentSegments.push(...(input.contentSegments ?? []));
    workBlock.thinkingSegments.push(...(input.thinkingSegments ?? []));
    workBlock.toolRuns.push(...(input.toolRuns ?? []));
    appendWorkItems(workBlock.items, input.items ?? defaultWorkItems(segment, input));
  };

  const flushWork = () => {
    if (!workBlock) return;
    const active = workBlock.segments.some((segment) => segment.status === 'streaming') || workBlock.toolRuns.some(isActiveRuntimeToolRun);
    blocks.push({
      type: 'work',
      id: workBlock.id,
      segments: workBlock.segments,
      toolRuns: workBlock.toolRuns,
      items: workBlock.items,
      contentSegments: workBlock.contentSegments,
      thinkingSegments: workBlock.thinkingSegments,
      active,
    });
    workBlock = null;
  };

  // 插件提供的 Skill 会在首个模型令牌前注入。预先创建工作块，
  // 使其归属信息与工具保持在同一条流式时间线中。
  if (pluginUses.length && segments[0]) {
    appendWork(segments[0], {
      items: [{ type: 'pluginUses', id: `${segments[0].id}:plugins`, plugins: pluginUses }],
    });
  }

  const parsedSegmentById = new Map(parsedSegments.map((parsed, index) => [parsed.segment.id, { index, parsed }]));
  const timelineMessages = orderedAssistantTimelineMessages(
    segments,
    options.contextCompactions ?? [],
    options.messageOrderIds ?? [],
  );

  timelineMessages.forEach((message) => {
    if (message.contextCompaction) {
      appendWork(message, {
        items: [{ type: 'contextCompaction', active: false, id: message.id, message }],
      });
      return;
    }
    const parsedEntry = parsedSegmentById.get(message.id);
    if (!parsedEntry) return;
    const { index, parsed } = parsedEntry;
    const inFinalAnswer = finalStarted && index >= finalStartIndex;
    // Walk the item stream directly so retained thinking and any work that follows
    // final content stay at their real transcript positions.
    parsed.items.forEach((item) => {
      if (item.type === 'thinking') {
        appendWork(parsed.segment, {
          items: [item],
          thinkingSegments: [item.segment],
        });
        return;
      }
      if (item.type === 'content') {
        if (!inFinalAnswer || !isCommittedFinalAnswer(item.segment.segment)) {
          appendWork(parsed.segment, {
            contentSegments: [item.segment],
            items: [item],
          });
          return;
        }
        flushWork();
        blocks.push({
          type: 'content',
          id: item.segment.id,
          segment: parsed.segment,
          content: item.segment.content,
        });
        return;
      }
      if (item.type === 'pluginUses') {
        appendWork(parsed.segment, { items: [item] });
        return;
      }
      if (item.type === 'toolRuns') {
        appendWork(parsed.segment, {
          items: [item],
          toolRuns: item.toolRuns,
        });
      }
    });

    if (isEmptyStreamingAssistantSegment(parsed.segment)) {
      flushWork();
      blocks.push({ type: 'loading', id: `${parsed.segment.id}:loading`, segment: parsed.segment });
    }
    if (parsed.segment.error) {
      flushWork();
      blocks.push({ type: 'error', id: `${parsed.segment.id}:error`, segment: parsed.segment });
    }
  });

  if (options.contextCompactionActive && segments.length) {
    appendWork(segments[segments.length - 1]!, {
      items: [{ type: 'contextCompaction', active: true, id: 'context-compaction-active' }],
    });
  }

  flushWork();
  return blocks;
}

function orderedAssistantTimelineMessages(
  segments: RuntimeMessage[],
  contextCompactions: RuntimeMessage[],
  messageOrderIds: string[],
): RuntimeMessage[] {
  if (!contextCompactions.length) return segments;
  const messages = [...segments, ...contextCompactions];
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const ordered = messageOrderIds.flatMap((id) => {
    const message = messageById.get(id);
    if (!message) return [];
    messageById.delete(id);
    return [message];
  });
  return [...ordered, ...messages.filter((message) => messageById.has(message.id))];
}

type ParsedAssistantSegment = {
  segment: RuntimeMessage;
  contentSegments: AssistantWorkContentSegment[];
  items: AssistantWorkItem[];
  thinkingSegments: AssistantWorkThinkingSegment[];
  toolRuns: NonNullable<RuntimeMessage['toolRuns']>;
};

function parseAssistantSegment(
  segment: RuntimeMessage,
  showThinkingInTranscript: boolean,
): ParsedAssistantSegment {
  const contentSegments: AssistantWorkContentSegment[] = [];
  const items: AssistantWorkItem[] = [];
  const thinkingSegments: AssistantWorkThinkingSegment[] = [];
  let contentIndex = 0;
  let thinkingIndex = 0;

  const appendContent = (contentValue: string) => {
    if (!contentValue.trim()) return;
    const content = {
      id: contentBlockId(segment.id, contentIndex),
      segment,
      content: contentValue,
    };
    contentSegments.push(content);
    items.push({ type: 'content', segment: content });
    contentIndex += 1;
  };
  const appendThinking = (contentValue: string, active: boolean) => {
    if ((!active && !showThinkingInTranscript) || !contentValue.trim()) return;
    const thinking = {
      id: thinkingSegmentId(segment.id, thinkingIndex),
      segment,
      content: contentValue,
      active,
    };
    thinkingSegments.push(thinking);
    items.push({ type: 'thinking', segment: thinking });
    thinkingIndex += 1;
  };

  if (segment.streamParts?.length) {
    if (segment.status !== 'streaming') {
      // Completed parts only record channel boundaries; hidden reasoning is not a visible
      // separator, so the finished answer must render as one cohesive Markdown stream
      // instead of splitting constructs that span two content parts.
      appendThinking(segment.streamParts
        .filter((part) => part.type === 'reasoning')
        .map((part) => part.content)
        .join(''), false);
      appendContent(segment.streamParts
        .filter((part) => part.type === 'content')
        .map((part) => part.content)
        .join(''));
    } else {
      const lastPartIndex = segment.streamParts.length - 1;
      segment.streamParts.forEach((part, index) => {
        if (part.type === 'content') appendContent(part.content);
        else appendThinking(part.content, index === lastPartIndex);
      });
    }
  } else if (segment.streamParts) {
    // An explicitly structured message with no streamed parts can still receive its final content
    // atomically at completion. Once parts exist, their channel boundary remains authoritative.
    appendContent(segment.content);
  } else {
    // Historical messages serialized reasoning into content. Keep this parser only as a
    // conservative read path; new messages carry ordered structured stream parts.
    for (const thinkingSegment of splitThinkingContent(segment.content, segment.status === 'streaming')) {
      if (thinkingSegment.type === 'markdown') {
        appendContent(thinkingSegment.content);
        continue;
      }
      appendThinking(
        thinkingSegment.content,
        segment.status === 'streaming' && !thinkingSegment.closed,
      );
    }
  }

  const toolRuns = (segment.toolRuns ?? []).filter((run) => !isTranscriptHiddenRuntimeToolRun(run));
  if (toolRuns.length) {
    items.push({ type: 'toolRuns', id: `${segment.id}:tools`, segment, toolRuns });
  }

  return {
    segment,
    contentSegments,
    items,
    thinkingSegments,
    toolRuns,
  };
}

function defaultWorkItems(
  segment: RuntimeMessage,
  input: {
    contentSegments?: AssistantWorkContentSegment[];
    thinkingSegments?: AssistantWorkThinkingSegment[];
    toolRuns?: NonNullable<RuntimeMessage['toolRuns']>;
  },
): AssistantWorkItem[] {
  return [
    ...(input.contentSegments ?? []).map((item): AssistantWorkItem => ({ type: 'content', segment: item })),
    ...(input.thinkingSegments ?? []).map((item): AssistantWorkItem => ({ type: 'thinking', segment: item })),
    ...(input.toolRuns?.length ? [{ type: 'toolRuns' as const, id: `${segment.id}:tools`, segment, toolRuns: input.toolRuns }] : []),
  ];
}

function appendWorkItems(items: AssistantWorkItem[], nextItems: AssistantWorkItem[]): void {
  for (const nextItem of nextItems) {
    const previousItem = items.at(-1);
    if (previousItem?.type === 'toolRuns' && nextItem.type === 'toolRuns') {
      items[items.length - 1] = {
        type: 'toolRuns',
        // Consecutive tool segments share one rendered disclosure. Keep the first id so
        // streaming appends do not remount that disclosure and lose its local state.
        id: previousItem.id,
        segment: previousItem.segment,
        toolRuns: [...previousItem.toolRuns, ...nextItem.toolRuns],
      };
      continue;
    }
    items.push(nextItem);
  }
}

function assistantFinalStartIndex(segments: ParsedAssistantSegment[]): number {
  // Runtime assigns phase only when completing a segment, so streaming text remains the
  // append-only work tail and can never be promoted above a later tool call.
  return segments.findIndex((segment) => isCommittedFinalAnswer(segment.segment));
}

function isCommittedFinalAnswer(segment: RuntimeMessage): boolean {
  return segment.phase === 'final_answer' && segment.status !== 'streaming';
}

function addWorkSegment(
  segments: RuntimeMessage[],
  seenIds: Set<string>,
  segment: RuntimeMessage,
): void {
  if (seenIds.has(segment.id)) return;
  seenIds.add(segment.id);
  segments.push(segment);
}

function contentBlockId(segmentId: string, index: number): string {
  return index === 0 ? `${segmentId}:content` : `${segmentId}:content:${index}`;
}

function thinkingSegmentId(segmentId: string, index: number): string {
  return index === 0 ? `${segmentId}:thinking` : `${segmentId}:thinking:${index}`;
}

function isEmptyStreamingAssistantSegment(segment: RuntimeMessage): boolean {
  const hasStructuredPart = segment.streamParts?.some((part) => Boolean(part.content.trim()));
  return segment.status === 'streaming'
    && !hasStructuredPart
    && !hasRenderableThinkingContent(segment.content, true)
    && !segment.toolRuns?.length
    && !segment.error;
}

export function shouldShowAssistantTrailingLoading({
  active,
  hasRenderableContent,
  status,
  toolRuns,
}: {
  active: boolean;
  hasRenderableContent: boolean;
  status: RuntimeMessage['status'];
  toolRuns: NonNullable<RuntimeMessage['toolRuns']>;
}): boolean {
  return active
    && status !== 'error'
    && hasRenderableContent
    && !toolRuns.some((run) => !isTranscriptHiddenRuntimeToolRun(run) && isActiveRuntimeToolRun(run));
}
