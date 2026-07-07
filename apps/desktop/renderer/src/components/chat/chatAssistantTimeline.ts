import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { hasRenderableThinkingContent, splitThinkingContent } from './chatThinkingContent.js';
import { isRuntimeFileMutationRun } from './runtimeFileChanges.js';

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
};

export type AssistantWorkItem =
  | { type: 'content'; segment: AssistantWorkContentSegment }
  | { type: 'thinking'; segment: AssistantWorkThinkingSegment }
  | { type: 'toolRuns'; id: string; segment: RuntimeMessage; toolRuns: NonNullable<RuntimeMessage['toolRuns']> };

export function createAssistantRunTimeline(segments: RuntimeMessage[]): AssistantRunTimelineBlock[] {
  const parsedSegments = segments.map(parseAssistantSegment);
  const lastProcessIndex = parsedSegments.reduce((lastIndex, parsed, index) => (hasProcessEvidence(parsed) ? index : lastIndex), -1);
  const finalStartIndex = parsedSegments.findIndex(
    (parsed, index) => index > lastProcessIndex && parsed.contentSegments.length > 0,
  );
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
    const hideThinkingItems = workBlock.toolRuns.some(isFileChangeWorkflowRun);
    blocks.push({
      type: 'work',
      id: workBlock.id,
      segments: workBlock.segments,
      toolRuns: workBlock.toolRuns,
      items: hideThinkingItems ? workBlock.items.filter((item) => item.type !== 'thinking') : workBlock.items,
      contentSegments: workBlock.contentSegments,
      thinkingSegments: workBlock.thinkingSegments,
      active: workBlock.segments.some((segment) => segment.status === 'streaming') || workBlock.toolRuns.some(isActiveWorkToolRun),
    });
    workBlock = null;
  };

  parsedSegments.forEach((parsed, index) => {
    const inFinalAnswer = finalStarted && index >= finalStartIndex;
    if (!inFinalAnswer) {
      if (parsed.contentSegments.length || parsed.thinkingSegments.length || parsed.toolRuns.length) {
        appendWork(parsed.segment, parsed);
      }
    } else {
      parsed.thinkingSegments.forEach((thinkingSegment) => {
        appendWork(parsed.segment, { thinkingSegments: [thinkingSegment] });
      });
      parsed.contentSegments.forEach((contentSegment) => {
        flushWork();
        blocks.push({
          type: 'content',
          id: contentSegment.id,
          segment: parsed.segment,
          content: contentSegment.content,
        });
      });
      if (parsed.toolRuns.length) {
        appendWork(parsed.segment, { toolRuns: parsed.toolRuns });
      }
    }

    if (isEmptyStreamingAssistantSegment(parsed.segment)) {
      flushWork();
      blocks.push({ type: 'loading', id: `${parsed.segment.id}:loading`, segment: parsed.segment });
    }
    if (parsed.segment.error) {
      flushWork();
      blocks.push({ type: 'error', id: `${parsed.segment.id}:error`, segment: parsed.segment });
    }
  });

  flushWork();
  return blocks;
}

type ParsedAssistantSegment = {
  segment: RuntimeMessage;
  contentSegments: AssistantWorkContentSegment[];
  items: AssistantWorkItem[];
  thinkingSegments: AssistantWorkThinkingSegment[];
  toolRuns: NonNullable<RuntimeMessage['toolRuns']>;
};

function parseAssistantSegment(segment: RuntimeMessage): ParsedAssistantSegment {
  const contentSegments: AssistantWorkContentSegment[] = [];
  const items: AssistantWorkItem[] = [];
  const thinkingSegments: AssistantWorkThinkingSegment[] = [];
  let contentIndex = 0;
  let thinkingIndex = 0;

  for (const thinkingSegment of splitThinkingContent(segment.content)) {
    if (thinkingSegment.type === 'markdown') {
      if (thinkingSegment.content.trim()) {
        const content = {
          id: contentBlockId(segment.id, contentIndex),
          segment,
          content: thinkingSegment.content,
        };
        contentSegments.push(content);
        items.push({ type: 'content', segment: content });
        contentIndex += 1;
      }
      continue;
    }

    if (segment.status === 'streaming' && !thinkingSegment.closed && thinkingSegment.content.trim()) {
      const thinking = {
        id: thinkingSegmentId(segment.id, thinkingIndex),
        segment,
        content: thinkingSegment.content,
      };
      thinkingSegments.push(thinking);
      items.push({ type: 'thinking', segment: thinking });
      thinkingIndex += 1;
    }
  }

  const toolRuns = segment.toolRuns ?? [];
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
        id: `${previousItem.id}+${nextItem.id}`,
        segment: previousItem.segment,
        toolRuns: [...previousItem.toolRuns, ...nextItem.toolRuns],
      };
      continue;
    }
    items.push(nextItem);
  }
}

function hasProcessEvidence(segment: ParsedAssistantSegment): boolean {
  return segment.thinkingSegments.length > 0 || segment.toolRuns.length > 0;
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
  return segment.status === 'streaming' && !hasRenderableThinkingContent(segment.content, true) && !segment.toolRuns?.length && !segment.error;
}

function isActiveWorkToolRun(run: NonNullable<RuntimeMessage['toolRuns']>[number]): boolean {
  return run.status === 'running' || (run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected');
}

function isFileChangeWorkflowRun(run: NonNullable<RuntimeMessage['toolRuns']>[number]): boolean {
  return run.name === 'plan_file_changes' || run.name === 'begin_file_change' || isRuntimeFileMutationRun(run);
}
