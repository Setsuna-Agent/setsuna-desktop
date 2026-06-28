import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { hasRenderableThinkingContent, splitThinkingContent } from './chatThinkingContent.js';

export type AssistantRunTimelineBlock =
  | { type: 'work'; id: string; segments: RuntimeMessage[]; toolRuns: NonNullable<RuntimeMessage['toolRuns']>; active: boolean; thinkingSegments: AssistantWorkThinkingSegment[] }
  | { type: 'content'; id: string; segment: RuntimeMessage; content: string }
  | { type: 'loading'; id: string; segment: RuntimeMessage }
  | { type: 'error'; id: string; segment: RuntimeMessage };

export type AssistantWorkThinkingSegment = {
  id: string;
  content: string;
};

export function createAssistantRunTimeline(segments: RuntimeMessage[]): AssistantRunTimelineBlock[] {
  const contentBlocks: AssistantRunTimelineBlock[] = [];
  const workSegments: RuntimeMessage[] = [];
  const workSegmentIds = new Set<string>();
  const workToolRuns: NonNullable<RuntimeMessage['toolRuns']> = [];
  const thinkingSegments: AssistantWorkThinkingSegment[] = [];

  for (const segment of segments) {
    const toolRuns = segment.toolRuns ?? [];
    const hasTools = toolRuns.length > 0;
    let contentIndex = 0;
    let thinkingIndex = 0;

    for (const thinkingSegment of splitThinkingContent(segment.content)) {
      if (thinkingSegment.type === 'markdown') {
        if (thinkingSegment.content.trim()) {
          contentBlocks.push({
            type: 'content',
            id: contentBlockId(segment.id, contentIndex),
            segment,
            content: thinkingSegment.content,
          });
          contentIndex += 1;
        }
        continue;
      }

      if (segment.status === 'streaming' && !thinkingSegment.closed && thinkingSegment.content.trim()) {
        addWorkSegment(workSegments, workSegmentIds, segment);
        thinkingSegments.push({
          id: thinkingSegmentId(segment.id, thinkingIndex),
          content: thinkingSegment.content,
        });
        thinkingIndex += 1;
      }
    }

    if (hasTools) {
      addWorkSegment(workSegments, workSegmentIds, segment);
      workToolRuns.push(...toolRuns);
    }

    if (isEmptyStreamingAssistantSegment(segment)) {
      contentBlocks.push({ type: 'loading', id: `${segment.id}:loading`, segment });
    }
    if (segment.error) {
      contentBlocks.push({ type: 'error', id: `${segment.id}:error`, segment });
    }
  }

  if (!workSegments.length && !workToolRuns.length && !thinkingSegments.length) return contentBlocks;
  return [
    {
      type: 'work',
      id: assistantRunWorkBlockId(segments),
      segments: workSegments,
      toolRuns: workToolRuns,
      thinkingSegments,
      active: workSegments.some((segment) => segment.status === 'streaming') || workToolRuns.some(isActiveWorkToolRun),
    },
    ...contentBlocks,
  ];
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

function assistantRunWorkBlockId(segments: RuntimeMessage[]): string {
  return `${segments[0]?.id ?? 'assistant'}:work`;
}

function isEmptyStreamingAssistantSegment(segment: RuntimeMessage): boolean {
  return segment.status === 'streaming' && !hasRenderableThinkingContent(segment.content, true) && !segment.toolRuns?.length && !segment.error;
}

function isActiveWorkToolRun(run: NonNullable<RuntimeMessage['toolRuns']>[number]): boolean {
  return run.status === 'running' || (run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected');
}
