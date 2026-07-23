import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import type { Translate } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import type {
  ConversationDebugLane,
  ConversationDebugNode,
  ConversationDebugNodeKind,
  ConversationDebugNodeStatus,
} from './conversationDebugGraph.js';

const laneLabelKeys: Record<ConversationDebugLane, MessageKey> = {
  user: 'conversationDebug.lane.user',
  runtime: 'conversationDebug.lane.runtime',
  provider: 'conversationDebug.lane.provider',
  tool: 'conversationDebug.lane.tool',
};

const nodeTitleKeys: Record<ConversationDebugNodeKind, MessageKey> = {
  approval: 'conversationDebug.node.approval',
  compaction: 'conversationDebug.node.compaction',
  diff: 'conversationDebug.node.diff',
  error: 'conversationDebug.node.error',
  event: 'conversationDebug.node.event',
  history: 'conversationDebug.node.history',
  'history-normalization': 'conversationDebug.node.historyNormalization',
  hook: 'conversationDebug.node.hook',
  mailbox: 'conversationDebug.node.mailbox',
  message: 'conversationDebug.node.message',
  'model-request': 'conversationDebug.node.modelRequest',
  'provider-replay': 'conversationDebug.node.providerReplay',
  safety: 'conversationDebug.node.safety',
  'stream-item': 'conversationDebug.node.streamItem',
  thread: 'conversationDebug.node.thread',
  tool: 'conversationDebug.node.tool',
  'turn-end': 'conversationDebug.node.turnEnd',
  'turn-input': 'conversationDebug.node.turnInput',
  usage: 'conversationDebug.node.usage',
  verification: 'conversationDebug.node.verification',
  warning: 'conversationDebug.node.warning',
};

const statusLabelKeys: Record<ConversationDebugNodeStatus, MessageKey> = {
  cancelled: 'conversationDebug.status.cancelled',
  error: 'conversationDebug.status.error',
  neutral: 'conversationDebug.status.neutral',
  running: 'conversationDebug.status.running',
  success: 'conversationDebug.status.success',
  warning: 'conversationDebug.status.warning',
};

export function conversationDebugLaneLabel(lane: ConversationDebugLane, t: Translate): string {
  return t(laneLabelKeys[lane]);
}

export function conversationDebugNodeTitle(node: ConversationDebugNode, t: Translate): string {
  const base = t(nodeTitleKeys[node.kind]);
  const detail = debugNodeTitleDetail(node.events);
  return detail ? `${base} · ${detail}` : base;
}

export function conversationDebugStatusLabel(
  status: ConversationDebugNodeStatus,
  t: Translate,
): string {
  return t(statusLabelKeys[status]);
}

function debugNodeTitleDetail(events: RuntimeEvent[]): string {
  for (const event of events) {
    switch (event.type) {
      case 'tool.preview':
      case 'tool.started':
      case 'tool.output_delta':
      case 'tool.completed':
        return event.payload.toolName;
      case 'hook.started':
      case 'hook.completed':
        return event.payload.eventName;
      case 'approval.requested':
        return event.payload.approval.toolName;
      case 'item.started':
      case 'item.completed':
        return event.payload.item.name
          ?? event.payload.item.toolCall?.name
          ?? event.payload.item.kind;
      case 'message.created':
        return event.payload.message.role;
      case 'turn.step_snapshot':
        return event.payload.snapshot.worldState.activeProviderId ?? '';
      case 'runtime.warning':
      case 'runtime.error':
        return event.payload.code ?? '';
      default:
        break;
    }
  }
  return '';
}
