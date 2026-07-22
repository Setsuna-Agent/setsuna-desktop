import type { RuntimeMessage } from '../threads.js';
import type { SweThreadItem } from './types.js';

export function agentMessageItem(id: string, text: string, memoryCitation: RuntimeMessage['memoryCitation'] | null = null): SweThreadItem {
  return { type: 'agentMessage', id, text, phase: null, memoryCitation };
}

export function planItem(id: string, text: string, status?: NonNullable<RuntimeMessage['planMode']>['status']): SweThreadItem {
  return { type: 'plan', id, text, ...(status ? { status } : {}) };
}

export function reasoningItem(id: string, summary: string[] = [], content: string[] = []): SweThreadItem {
  return { type: 'reasoning', id, summary, content };
}

export function contextCompactionItem(id: string): SweThreadItem {
  return { type: 'contextCompaction', id };
}

export function reviewModeItem(turnId: string, notice: NonNullable<RuntimeMessage['reviewMode']>): SweThreadItem {
  return {
    type: notice.kind === 'entered' ? 'enteredReviewMode' : 'exitedReviewMode',
    id: turnId,
    review: notice.review,
  };
}

export function contextCompactionItemId(turnId: string): string {
  return `${turnId}:context_compaction`;
}

export function isClosingThinkTag(tag: string): boolean {
  const normalized = tag.toLowerCase();
  return normalized.startsWith('</') || normalized.startsWith('&lt;/');
}

export function agentMessageItemId(messageId: string, segmentIndex: number): string {
  return segmentIndex === 0 ? messageId : `${messageId}:agent:${segmentIndex}`;
}

export function reasoningItemId(messageId: string, segmentIndex: number): string {
  return segmentIndex === 0 ? `${messageId}:reasoning` : `${messageId}:reasoning:${segmentIndex}`;
}
