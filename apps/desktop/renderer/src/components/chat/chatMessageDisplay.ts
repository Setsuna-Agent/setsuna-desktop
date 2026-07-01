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

/**
 * 将存储中的 runtime messages 转成用户可见的 transcript 行，同时保持源事件顺序。
 *
 * @param messages reducer 投影后的线程消息列表。
 */
export function buildChatTranscript(messages: RuntimeMessage[]): ChatTranscriptItem[] {
  const items: ChatTranscriptItem[] = [];
  let assistantRun: RuntimeMessage[] = [];
  let assistantRunMessageIds: string[] = [];
  let assistantRunTurnId: string | undefined;

  const flushAssistantRun = () => {
    if (!assistantRun.length) return;
    // 一个 assistant run 可能由“回答段 + 工具段 + 最终回答段”组成，UI 上合并成一组。
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

  // transcript 顺序以 reducer 投影为准，包括上下文压缩分隔符的位置。
  for (const message of messages) {
    // model-only 消息只服务 prompt，不应该出现在用户 transcript。
    if (message.visibility === 'model') continue;
    if (message.role === 'tool') {
      // tool 消息本身不渲染成独立气泡，只并入同 turn 的 assistant run 复制/删除范围。
      if (assistantRun.length && sameTurn(message.turnId, assistantRunTurnId)) assistantRunMessageIds.push(message.id);
      continue;
    }
    if (message.role === 'system') {
      if (message.contextCompaction || message.reviewMode) {
        // 只有具备 UI 语义的 system 消息才显示：上下文压缩或 review 模式标记。
        flushAssistantRun();
        items.push({ type: message.contextCompaction ? 'context' : 'review', id: message.id, message });
      }
      continue;
    }
    if (message.role === 'assistant') {
      // 同一 turn 的连续 assistant 消息代表同一个可见 run，只是 runtime 分成了多段。
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

/**
 * 对长对话做尾部窗口化渲染，同时保证 active turn 即使不在尾部也会被保留。
 *
 * @param items 已构建好的 transcript 行。
 * @param activeTurnId 当前运行中的 turn ID，用于强制保留可见区域。
 * @param enabled 是否启用窗口化；删除模式和查看全量历史时会关闭。
 * @param tailItemLimit 默认保留的尾部 transcript 行数。
 */
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
  // active turn 比尾部更早时，从 active turn 开始渲染，避免流式回答消失在窗口外。
  const start = activeStart >= 0 ? Math.min(tailStart, activeStart) : tailStart;
  const hiddenItems = items.slice(0, start);
  return {
    hiddenItemCount: hiddenItems.length,
    hiddenMessageCount: hiddenItems.reduce((count, item) => count + transcriptItemMessageCount(item), 0),
    items: items.slice(start),
  };
}

/**
 * 生成给滚动 effect 使用的紧凑依赖 key，避免把完整 message 对象放进 React deps。
 *
 * @param renderWindow 当前渲染窗口。
 * @param activeTurnId 当前运行中的 turn ID。
 * @param contextCompactionRunning 上下文压缩是否正在运行。
 * @param threadId 当前线程 ID。
 */
export function createChatScrollSignal(
  renderWindow: ChatRenderWindow,
  {
    activeTurnId = null,
    contextCompactionRunning = false,
    threadId = null,
  }: ChatScrollSignalOptions = {},
): string {
  const visibleItemsSignal = renderWindow.items.map(transcriptItemScrollSignal).join('|');
  // 信号只包含影响高度或 pinned 逻辑的字段，减少无关状态导致的滚动重算。
  return [
    threadId ?? 'new',
    activeTurnId ?? '',
    contextCompactionRunning ? 'compacting' : 'idle',
    renderWindow.hiddenItemCount,
    renderWindow.hiddenMessageCount,
    visibleItemsSignal,
  ].join(':');
}

/**
 * 汇总一个 assistant run 的显示状态。
 *
 * @param item assistant 类型的 transcript 行。
 */
export function assistantRunStatus(item: Extract<ChatDisplayItem, { type: 'assistant' }>): RuntimeMessage['status'] {
  if (item.segments.some((message) => message.status === 'streaming')) return 'streaming';
  if (item.segments.some((message) => message.status === 'error')) return 'error';
  return item.segments.at(-1)?.status ?? 'complete';
}

/**
 * 判断 assistant run 是否属于当前 active turn。
 *
 * @param item assistant 类型的 transcript 行。
 * @param activeTurnId 当前运行中的 turn ID。
 */
export function assistantRunIsActive(item: Extract<ChatDisplayItem, { type: 'assistant' }>, activeTurnId: string | null): boolean {
  return Boolean(activeTurnId && item.segments.some((message) => message.turnId === activeTurnId));
}

/**
 * 生成复制 assistant run 时使用的纯文本内容。
 *
 * @param item assistant 类型的 transcript 行。
 */
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
  // context 分隔符没有 turn 归属，不参与 active turn 保留策略。
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
  // 内容长度而不是内容全文足够驱动滚动重算，也能避免大段 Markdown 进入依赖 key。
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
