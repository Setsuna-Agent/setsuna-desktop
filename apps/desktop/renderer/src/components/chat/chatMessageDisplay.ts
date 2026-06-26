import type { RuntimeMessage } from '@setsuna-desktop/contracts';

export type ChatDisplayItem =
  | { type: 'user'; id: string; message: RuntimeMessage }
  | { type: 'assistant'; id: string; messageIds: string[]; segments: RuntimeMessage[] }
  | { type: 'context'; id: string; message: RuntimeMessage };

export function createChatDisplayItems(messages: RuntimeMessage[]): ChatDisplayItem[] {
  const items: ChatDisplayItem[] = [];
  let assistantRun: RuntimeMessage[] = [];
  let assistantRunMessageIds: string[] = [];
  const manualContextItems: ChatDisplayItem[] = [];

  const flushAssistantRun = () => {
    if (!assistantRun.length) return;
    items.push({
      type: 'assistant',
      id: assistantRun.map((message) => message.id).join('__assistant_run__'),
      messageIds: assistantRunMessageIds,
      segments: assistantRun,
    });
    assistantRun = [];
    assistantRunMessageIds = [];
  };

  for (const message of messages) {
    if (message.role === 'tool') {
      if (assistantRun.length) assistantRunMessageIds.push(message.id);
      continue;
    }
    if (message.role === 'system') {
      if (message.contextCompaction) {
        flushAssistantRun();
        const item = { type: 'context' as const, id: message.id, message };
        if (message.contextCompaction.triggerScopes?.includes('manual')) {
          manualContextItems.push(item);
        } else {
          items.push(item);
        }
      }
      continue;
    }
    if (message.role === 'assistant') {
      assistantRun.push(message);
      assistantRunMessageIds.push(message.id);
      continue;
    }
    flushAssistantRun();
    items.push({ type: 'user', id: message.id, message });
  }

  flushAssistantRun();
  items.push(...manualContextItems);
  return items;
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
      segment.content.trim(),
      ...(segment.toolRuns ?? []).map((run) => `${toolRunStatusLabel(run.status)} ${run.name}`.trim()),
      segment.error?.trim() ?? '',
    ])
    .filter(Boolean)
    .join('\n\n');
}

function toolRunStatusLabel(status: NonNullable<RuntimeMessage['toolRuns']>[number]['status']): string {
  if (status === 'pending_approval') return '等待授权';
  if (status === 'running') return '正在使用';
  if (status === 'success') return '已使用';
  if (status === 'rejected') return '已拒绝';
  return '调用失败';
}
