import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { visibleMarkdownContent } from './chatThinkingContent.js';

export type ChatTranscriptItem =
  | { type: 'user'; id: string; message: RuntimeMessage }
  | { type: 'assistant'; id: string; messageIds: string[]; segments: RuntimeMessage[]; turnId?: string }
  | { type: 'context'; id: string; message: RuntimeMessage }
  | { type: 'review'; id: string; message: RuntimeMessage };

export type ChatDisplayItem = ChatTranscriptItem;

export type ChatRenderWindow = {
  hiddenItemCount: number;
  hiddenMessageCount: number;
  items: ChatTranscriptItem[];
};

export type ChatScrollSignalOptions = {
  activeTurnId?: string | null;
  contextCompactionRunning?: boolean;
  threadId?: string | null;
};

export function buildChatTranscript(messages: RuntimeMessage[]): ChatTranscriptItem[] {
  const items: ChatTranscriptItem[] = [];
  let assistantRun: RuntimeMessage[] = [];
  let assistantRunMessageIds: string[] = [];
  let assistantRunTurnId: string | undefined;

  const flushAssistantRun = () => {
    if (!assistantRun.length) return;
    items.push({
      type: 'assistant',
      id: assistantRun.map((message) => message.id).join('__assistant_run__'),
      messageIds: assistantRunMessageIds,
      segments: assistantRun,
      turnId: assistantRunTurnId,
    });
    assistantRun = [];
    assistantRunMessageIds = [];
    assistantRunTurnId = undefined;
  };

  // Keep transcript order source-backed: the reducer decides history shape, including compaction placement.
  for (const message of messages) {
    if (message.visibility === 'model') continue;
    if (message.role === 'tool') {
      if (assistantRun.length && sameTurn(message.turnId, assistantRunTurnId)) assistantRunMessageIds.push(message.id);
      continue;
    }
    if (message.role === 'system') {
      if (message.contextCompaction || message.reviewMode) {
        flushAssistantRun();
        items.push({ type: message.contextCompaction ? 'context' : 'review', id: message.id, message });
      }
      continue;
    }
    if (message.role === 'assistant') {
      if (assistantRun.length && !sameTurn(message.turnId, assistantRunTurnId)) flushAssistantRun();
      assistantRunTurnId = assistantRunTurnId ?? message.turnId;
      assistantRun.push(message);
      assistantRunMessageIds.push(message.id);
      continue;
    }
    flushAssistantRun();
    items.push({ type: 'user', id: message.id, message });
  }

  flushAssistantRun();
  return items;
}

export function createChatDisplayItems(messages: RuntimeMessage[]): ChatDisplayItem[] {
  return buildChatTranscript(messages);
}

export function createChatRenderWindow(
  items: ChatTranscriptItem[],
  {
    activeTurnId,
    enabled = true,
    tailItemLimit = 80,
  }: {
    activeTurnId?: string | null;
    enabled?: boolean;
    tailItemLimit?: number;
  } = {},
): ChatRenderWindow {
  const limit = Math.max(1, Math.floor(tailItemLimit));
  if (!enabled || items.length <= limit) {
    return { hiddenItemCount: 0, hiddenMessageCount: 0, items };
  }

  const tailStart = Math.max(0, items.length - limit);
  const activeStart = activeTurnId ? items.findIndex((item) => itemIncludesTurn(item, activeTurnId)) : -1;
  const start = activeStart >= 0 ? Math.min(tailStart, activeStart) : tailStart;
  const hiddenItems = items.slice(0, start);
  return {
    hiddenItemCount: hiddenItems.length,
    hiddenMessageCount: hiddenItems.reduce((count, item) => count + transcriptItemMessageCount(item), 0),
    items: items.slice(start),
  };
}

export function createChatScrollSignal(
  renderWindow: ChatRenderWindow,
  {
    activeTurnId = null,
    contextCompactionRunning = false,
    threadId = null,
  }: ChatScrollSignalOptions = {},
): string {
  const visibleItemsSignal = renderWindow.items.map(transcriptItemScrollSignal).join('|');
  return [
    threadId ?? 'new',
    activeTurnId ?? '',
    contextCompactionRunning ? 'compacting' : 'idle',
    renderWindow.hiddenItemCount,
    renderWindow.hiddenMessageCount,
    visibleItemsSignal,
  ].join(':');
}

export function assistantRunStatus(item: Extract<ChatDisplayItem, { type: 'assistant' }>): RuntimeMessage['status'] {
  if (item.segments.some((message) => message.status === 'streaming')) return 'streaming';
  if (item.segments.some((message) => message.status === 'error')) return 'error';
  return item.segments.at(-1)?.status ?? 'complete';
}

export function assistantRunIsActive(item: Extract<ChatDisplayItem, { type: 'assistant' }>, activeTurnId: string | null): boolean {
  return Boolean(activeTurnId && item.segments.some((message) => message.turnId === activeTurnId));
}

export function assistantRunCopyText(item: Extract<ChatDisplayItem, { type: 'assistant' }>): string {
  return item.segments
    .flatMap((segment) => [
      visibleMarkdownContent(segment.content).trim(),
      ...(segment.toolRuns ?? []).map((run) => `${toolRunStatusLabel(run.status)} ${run.name}`.trim()),
      segment.error?.trim() ?? '',
    ])
    .filter(Boolean)
    .join('\n\n');
}

function sameTurn(nextTurnId: string | undefined, currentTurnId: string | undefined): boolean {
  return !nextTurnId || !currentTurnId || nextTurnId === currentTurnId;
}

function itemIncludesTurn(item: ChatTranscriptItem, turnId: string): boolean {
  if (item.type === 'assistant') return item.turnId === turnId || item.segments.some((message) => message.turnId === turnId);
  return item.type === 'user' || item.type === 'review' ? item.message.turnId === turnId : false;
}

function transcriptItemMessageCount(item: ChatTranscriptItem): number {
  if (item.type === 'assistant') return item.messageIds.length || item.segments.length;
  return 1;
}

function transcriptItemScrollSignal(item: ChatTranscriptItem): string {
  if (item.type === 'assistant') {
    return `assistant:${item.id}:${item.segments.map(messageScrollSignal).join(',')}`;
  }
  return `${item.type}:${messageScrollSignal(item.message)}`;
}

function messageScrollSignal(message: RuntimeMessage): string {
  return [
    message.id,
    message.role,
    message.status,
    message.content.length,
    message.completedAt ?? '',
    message.error?.length ?? 0,
    message.attachments?.length ?? 0,
    message.reviewMode ? `${message.reviewMode.kind}:${message.reviewMode.review.length}` : '',
    message.toolRuns?.map(toolRunScrollSignal).join(';') ?? '',
  ].join(',');
}

function toolRunScrollSignal(run: NonNullable<RuntimeMessage['toolRuns']>[number]): string {
  return [
    run.id,
    run.status,
    run.approvalStatus ?? '',
    run.resultPreview?.length ?? 0,
    run.approvalMessage?.length ?? 0,
    run.startedAt ?? '',
    run.completedAt ?? '',
    run.durationMs ?? '',
  ].join(',');
}

function toolRunStatusLabel(status: NonNullable<RuntimeMessage['toolRuns']>[number]['status']): string {
  if (status === 'pending_approval') return '等待授权';
  if (status === 'running') return '正在使用';
  if (status === 'success') return '已使用';
  if (status === 'rejected') return '已拒绝';
  return '调用失败';
}
