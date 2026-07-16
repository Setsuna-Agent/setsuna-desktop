import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { visibleMarkdownContent } from './chatThinkingContent.js';

export type ChatTranscriptItem =
  | { type: 'user'; id: string; handledSteerMessageIds: string[]; message: RuntimeMessage; messageIds: string[]; guidanceProcessed: boolean; steered: boolean; steerMessages: RuntimeMessage[] }
  | { type: 'assistant'; id: string; handledSteerMessageIds: string[]; messageIds: string[]; segments: RuntimeMessage[]; steerMessages: RuntimeMessage[]; turnId?: string }
  | { type: 'context'; id: string; message: RuntimeMessage }
  | { type: 'review'; id: string; message: RuntimeMessage };

export type ChatDisplayItem = ChatTranscriptItem;

/**
 * React identity must not change when more assistant segments stream into the same
 * visible run. The item id intentionally tracks the complete delete/copy range and
 * therefore grows as segments are appended.
 */
export function chatDisplayItemRenderKey(item: ChatDisplayItem): string {
  if (item.type === 'assistant') return `assistant:${item.segments[0]?.id ?? item.id}`;
  return `${item.type}:${item.id}`;
}

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

type TranscriptMessageEntry = {
  message: RuntimeMessage;
  sourceIndex: number;
};

/**
 * 将存储中的 runtime messages 转成用户可见的 transcript 行，并恢复压缩边界的事件位置。
 *
 * @param messages reducer 投影后的线程消息列表。
 */
export function buildChatTranscript(messages: RuntimeMessage[]): ChatTranscriptItem[] {
  const items: ChatTranscriptItem[] = [];
  let assistantRun: RuntimeMessage[] = [];
  let assistantRunHandledSteerMessageIds: string[] = [];
  let assistantRunMessageIds: string[] = [];
  let assistantRunSteerMessages: RuntimeMessage[] = [];
  let assistantRunTurnId: string | undefined;
  const pendingSteerMessageIdsByTurnId = new Map<string, string[]>();
  const userItemByTurnId = new Map<string, Extract<ChatTranscriptItem, { type: 'user' }>>();
  const seenUserTurnIds = new Set<string>();
  let lastUserItem: Extract<ChatTranscriptItem, { type: 'user' }> | null = null;

  const flushAssistantRun = () => {
    if (!assistantRun.length) return;
    // 一个 assistant run 可能由“回答段 + 工具段 + 最终回答段”组成，UI 上合并成一组。
    items.push({
      type: 'assistant',
      id: assistantRun.map((message) => message.id).join('__assistant_run__'),
      handledSteerMessageIds: assistantRunHandledSteerMessageIds,
      messageIds: assistantRunMessageIds,
      segments: assistantRun,
      steerMessages: assistantRunSteerMessages,
      turnId: assistantRunTurnId,
    });
    assistantRun = [];
    assistantRunHandledSteerMessageIds = [];
    assistantRunMessageIds = [];
    assistantRunSteerMessages = [];
    assistantRunTurnId = undefined;
  };

  // 压缩结果里的 messages 是模型窗口顺序；分隔符需要恢复到真实 transcript 时间线。
  for (const message of messagesInTranscriptOrder(messages)) {
    // model-only 消息只服务 prompt，不应该出现在用户 transcript。
    if (message.visibility === 'model') continue;
    if (message.role === 'tool') {
      // tool 消息本身不渲染成独立气泡，只并入同 turn 的 assistant run 复制/删除范围。
      if (assistantRun.length && sameTurn(message.turnId, assistantRunTurnId)) assistantRunMessageIds.push(message.id);
      continue;
    }
    if (message.contextCompaction) {
      flushAssistantRun();
      items.push({ type: 'context', id: message.id, message });
      continue;
    }
    if (message.role === 'system' || message.role === 'developer') {
      if (message.reviewMode) {
        // 普通 system/developer 消息不进 transcript；review 标记是显式 UI 事件。
        flushAssistantRun();
        items.push({ type: 'review', id: message.id, message });
      }
      continue;
    }
    if (message.role === 'assistant') {
      // 同一 turn 的连续 assistant 消息代表同一个可见 run，只是 runtime 分成了多段。
      if (assistantRun.length && !sameTurn(message.turnId, assistantRunTurnId)) flushAssistantRun();
      assistantRunTurnId = assistantRunTurnId ?? message.turnId;
      const turnId = message.turnId;
      if (turnId && !userItemByTurnId.has(turnId) && lastUserItem && (!lastUserItem.message.turnId || lastUserItem.message.turnId === turnId)) {
        userItemByTurnId.set(turnId, lastUserItem);
      }
      const handledSteerMessageIds = turnId && assistantHasProcessingEvidence(message)
        ? (pendingSteerMessageIdsByTurnId.get(turnId) ?? [])
        : [];
      if (turnId && handledSteerMessageIds.length) {
        assistantRunHandledSteerMessageIds.push(...handledSteerMessageIds);
        const userItem = userItemByTurnId.get(turnId);
        if (userItem) {
          userItem.handledSteerMessageIds.push(...handledSteerMessageIds);
          userItem.guidanceProcessed = true;
        }
        pendingSteerMessageIdsByTurnId.delete(turnId);
      }
      assistantRun.push(message);
      assistantRunMessageIds.push(message.id);
      continue;
    }
    const steered = Boolean(
      message.turnId
        && (seenUserTurnIds.has(message.turnId) || (assistantRun.length > 0 && sameTurn(message.turnId, assistantRunTurnId))),
    );
    if (message.turnId) seenUserTurnIds.add(message.turnId);
    if (steered && message.turnId) {
      let userItem = userItemByTurnId.get(message.turnId);
      if (!userItem && lastUserItem && (!lastUserItem.message.turnId || lastUserItem.message.turnId === message.turnId)) {
        userItem = lastUserItem;
        userItemByTurnId.set(message.turnId, userItem);
      }
      if (userItem) {
        userItem.messageIds.push(message.id);
        userItem.steerMessages.push(message);
      }
      if (assistantRun.length && sameTurn(message.turnId, assistantRunTurnId)) {
        assistantRunMessageIds.push(message.id);
        assistantRunSteerMessages.push(message);
      }
      const pending = pendingSteerMessageIdsByTurnId.get(message.turnId) ?? [];
      pending.push(message.id);
      pendingSteerMessageIdsByTurnId.set(message.turnId, pending);
      if (userItem || (assistantRun.length && sameTurn(message.turnId, assistantRunTurnId))) continue;
    }
    flushAssistantRun();
    const item: Extract<ChatTranscriptItem, { type: 'user' }> = {
      type: 'user',
      handledSteerMessageIds: [],
      id: message.id,
      message,
      messageIds: [message.id],
      guidanceProcessed: false,
      steered,
      steerMessages: [],
    };
    if (message.turnId) userItemByTurnId.set(message.turnId, item);
    lastUserItem = item;
    items.push(item);
  }

  flushAssistantRun();
  return items;
}

function messagesInTranscriptOrder(messages: RuntimeMessage[]): RuntimeMessage[] {
  const entries = messages.map((message, sourceIndex): TranscriptMessageEntry => ({ message, sourceIndex }));
  const boundaries = entries.filter(({ message }) => Boolean(message.contextCompaction));
  if (!boundaries.length) return messages;

  const timeline = entries.filter(({ message }) => !message.contextCompaction);
  boundaries.sort(compareTranscriptBoundaryEntries);
  for (const boundary of boundaries) {
    const anchorId = boundary.message.contextCompaction?.transcriptAfterMessageId;
    const anchorIndex = anchorId ? timeline.findIndex(({ message }) => message.id === anchorId) : -1;
    const insertAt = anchorIndex >= 0
      ? anchorIndex + 1
      : inferredTranscriptBoundaryIndex(timeline, boundary);
    timeline.splice(insertAt, 0, boundary);
  }
  return timeline.map(({ message }) => message);
}

function compareTranscriptBoundaryEntries(left: TranscriptMessageEntry, right: TranscriptMessageEntry): number {
  const leftTime = Date.parse(left.message.createdAt);
  const rightTime = Date.parse(right.message.createdAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
  return left.sourceIndex - right.sourceIndex;
}

function inferredTranscriptBoundaryIndex(timeline: TranscriptMessageEntry[], boundary: TranscriptMessageEntry): number {
  const boundaryTime = Date.parse(boundary.message.createdAt);
  if (Number.isFinite(boundaryTime)) {
    let insertAfter = -1;
    for (const [index, entry] of timeline.entries()) {
      const entryTime = Date.parse(entry.message.createdAt);
      if (Number.isFinite(entryTime) && entryTime <= boundaryTime) insertAfter = index;
    }
    return insertAfter + 1;
  }
  const sourcePosition = timeline.findIndex((entry) => entry.sourceIndex > boundary.sourceIndex);
  return sourcePosition >= 0 ? sourcePosition : timeline.length;
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
 * 找出当前 active turn 真正位于最前沿的 assistant run。
 *
 * 同一个 turn 里插入引导后，早先完成的 assistant 段仍有同一个 turnId，
 * 但不能继续显示“工作中”；最新的 active-turn user 之后还没生成 assistant 时返回 null。
 */
export function activeAssistantRunItemId(items: ChatDisplayItem[], activeTurnId: string | null): string | null {
  if (!activeTurnId) return null;
  let activeAssistantItemId: string | null = null;
  for (const item of items) {
    if (item.type === 'assistant' && assistantRunIncludesTurn(item, activeTurnId)) {
      activeAssistantItemId = item.id;
      continue;
    }
    if (item.type === 'user' && item.message.turnId === activeTurnId && !item.steered) {
      activeAssistantItemId = null;
    }
    if (item.type === 'review' && item.message.turnId === activeTurnId) {
      activeAssistantItemId = null;
    }
  }
  return activeAssistantItemId;
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
  if (item.type === 'assistant') return assistantRunIncludesTurn(item, turnId);
  return item.type === 'user' || item.type === 'review' || item.type === 'context'
    ? item.message.turnId === turnId
    : false;
}

function assistantRunIncludesTurn(item: Extract<ChatDisplayItem, { type: 'assistant' }>, turnId: string): boolean {
  return item.turnId === turnId || item.segments.some((message) => message.turnId === turnId);
}

function assistantHasProcessingEvidence(message: RuntimeMessage): boolean {
  return Boolean(message.content.trim() || message.toolCalls?.length || message.toolRuns?.length || message.error);
}

function transcriptItemMessageCount(item: ChatTranscriptItem): number {
  if (item.type === 'assistant') {
    const steerMessageIds = new Set(item.steerMessages.map((message) => message.id));
    return item.messageIds.filter((id) => !steerMessageIds.has(id)).length || item.segments.length;
  }
  if (item.type === 'user') return item.messageIds.length || 1;
  return 1;
}

function transcriptItemScrollSignal(item: ChatTranscriptItem): string {
  if (item.type === 'assistant') {
    return `assistant:${item.id}:${item.segments.map(messageScrollSignal).join(',')}:steer:${item.steerMessages.map(messageScrollSignal).join(',')}`;
  }
  if (item.type === 'user') {
    return `user:${messageScrollSignal(item.message)}:steer:${item.steerMessages.map(messageScrollSignal).join(',')}:${item.handledSteerMessageIds.join(',')}`;
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
    message.hookRuns?.map(hookRunScrollSignal).join(';') ?? '',
    message.toolRuns?.map(toolRunScrollSignal).join(';') ?? '',
  ].join(',');
}

function hookRunScrollSignal(run: NonNullable<RuntimeMessage['hookRuns']>[number]): string {
  return [
    run.id,
    run.status,
    run.message?.length ?? 0,
    run.entries?.length ?? 0,
    run.completedAt ?? '',
  ].join(':');
}

function toolRunScrollSignal(run: NonNullable<RuntimeMessage['toolRuns']>[number]): string {
  return [
    run.id,
    run.status,
    run.phase ?? '',
    run.approvalStatus ?? '',
    run.argumentsLength ?? 0,
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
  if (status === 'cancelled') return '已取消';
  return '调用失败';
}
