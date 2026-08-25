import type { RuntimeMessageRole, StoredThreadEvent } from '@setsuna-desktop/contracts';
import type {
  RendererFeatureMessageKey,
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  ConversationDebugLane,
  ConversationDebugNode,
  ConversationDebugNodeKind,
  ConversationDebugNodeStatus,
} from './conversationDebugGraph.js';
import { conversationDebugReplayMessageCount } from './conversationDebugTraces.js';

const laneLabelKeys: Record<ConversationDebugLane, RendererFeatureMessageKey> = {
  user: 'feature.conversationDebug.lane.user',
  runtime: 'feature.conversationDebug.lane.runtime',
  provider: 'feature.conversationDebug.lane.provider',
  tool: 'feature.conversationDebug.lane.tool',
};

const nodeTitleKeys: Record<ConversationDebugNodeKind, RendererFeatureMessageKey> = {
  approval: 'feature.conversationDebug.node.approval',
  compaction: 'feature.conversationDebug.node.compaction',
  diff: 'feature.conversationDebug.node.diff',
  error: 'feature.conversationDebug.node.error',
  event: 'feature.conversationDebug.node.event',
  history: 'feature.conversationDebug.node.history',
  'history-normalization': 'feature.conversationDebug.node.historyNormalization',
  hook: 'feature.conversationDebug.node.hook',
  mailbox: 'feature.conversationDebug.node.mailbox',
  message: 'feature.conversationDebug.node.message',
  'model-request': 'feature.conversationDebug.node.modelRequest',
  'provider-replay': 'feature.conversationDebug.node.providerReplay',
  safety: 'feature.conversationDebug.node.safety',
  'stream-item': 'feature.conversationDebug.node.streamItem',
  thread: 'feature.conversationDebug.node.thread',
  tool: 'feature.conversationDebug.node.tool',
  'turn-end': 'feature.conversationDebug.node.turnEnd',
  'turn-input': 'feature.conversationDebug.node.turnInput',
  usage: 'feature.conversationDebug.node.usage',
  verification: 'feature.conversationDebug.node.verification',
  warning: 'feature.conversationDebug.node.warning',
};

const statusLabelKeys: Record<ConversationDebugNodeStatus, RendererFeatureMessageKey> = {
  cancelled: 'feature.conversationDebug.status.cancelled',
  error: 'feature.conversationDebug.status.error',
  neutral: 'feature.conversationDebug.status.neutral',
  running: 'feature.conversationDebug.status.running',
  success: 'feature.conversationDebug.status.success',
  warning: 'feature.conversationDebug.status.warning',
};

const messageRoleLabelKeys: Record<RuntimeMessageRole, RendererFeatureMessageKey> = {
  assistant: 'feature.conversationDebug.messageRole.assistant',
  developer: 'feature.conversationDebug.messageRole.developer',
  system: 'feature.conversationDebug.messageRole.system',
  tool: 'feature.conversationDebug.messageRole.tool',
  user: 'feature.conversationDebug.messageRole.user',
};

export function conversationDebugLaneLabel(lane: ConversationDebugLane, t: RendererTranslate): string {
  return t(laneLabelKeys[lane]);
}

export function conversationDebugNodeTitle(node: ConversationDebugNode, t: RendererTranslate): string {
  const base = t(nodeTitleKeys[node.kind]);
  const detail = debugNodeTitleDetail(node.events, t);
  if (node.kind === 'message' && detail) return detail;
  return detail ? `${base} · ${detail}` : base;
}

export function conversationDebugNodeDescription(
  node: ConversationDebugNode,
  t: RendererTranslate,
): string {
  switch (node.kind) {
    case 'model-request': {
      const snapshotEvent = node.events.find((event) => event.type === 'turn.step_snapshot');
      if (snapshotEvent?.type !== 'turn.step_snapshot') break;
      return t('feature.conversationDebug.activity.modelRequest', {
        messages: snapshotEvent.payload.snapshot.messageIds.length,
        tools: snapshotEvent.payload.snapshot.toolNames.length,
      });
    }
    case 'provider-replay': {
      const replayTraces = node.traces.filter(
        (trace) => trace.kind === 'provider.replay.decision',
      );
      const requestCount = Math.max(1, new Set(
        replayTraces.map((trace) => trace.spanId).filter(Boolean),
      ).size);
      return t('feature.conversationDebug.activity.providerReplay', {
        messages: conversationDebugReplayMessageCount(replayTraces),
        requests: requestCount,
      });
    }
    case 'history-normalization': {
      const trace = node.traces.find((item) => item.kind === 'model.history.normalized');
      if (trace?.kind !== 'model.history.normalized') break;
      const issueCount = trace.payload.warnings.length
        + trace.payload.orphanToolResultMessageIds.length
        + trace.payload.interruptedToolResultMessageIds.length;
      return t('feature.conversationDebug.activity.historyNormalization', {
        input: trace.payload.inputMessageCount,
        issues: issueCount,
        output: trace.payload.outputMessageCount,
      });
    }
    case 'usage': {
      const usageEvent = node.events.find((event) => event.type === 'token.count');
      if (usageEvent?.type === 'token.count') {
        return t('feature.conversationDebug.activity.tokenUsage', {
          input: usageEvent.payload.usage.inputTokens ?? 0,
          output: usageEvent.payload.usage.outputTokens ?? 0,
        });
      }
      const streamTrace = node.traces.find((trace) => trace.kind === 'stream.pipeline.summary');
      if (streamTrace?.kind === 'stream.pipeline.summary') {
        return t('feature.conversationDebug.activity.streamSummary', {
          persisted: streamTrace.payload.persistedEventCount,
          received: streamTrace.payload.receivedEventCount,
        });
      }
      break;
    }
    case 'turn-end':
      return t('feature.conversationDebug.activity.turnEnd', {
        status: conversationDebugStatusLabel(node.status, t),
      });
    case 'compaction':
      return t('feature.conversationDebug.activity.compaction');
    case 'history':
      return t('feature.conversationDebug.activity.history');
    case 'verification':
      return t('feature.conversationDebug.activity.verification');
    case 'safety':
      return t('feature.conversationDebug.activity.safety');
    case 'diff':
      return t('feature.conversationDebug.activity.diff');
    case 'thread':
      return t('feature.conversationDebug.activity.thread');
    default:
      break;
  }
  return node.summary || t('feature.conversationDebug.activity.noDetail');
}

export function conversationDebugStatusLabel(
  status: ConversationDebugNodeStatus,
  t: RendererTranslate,
): string {
  return t(statusLabelKeys[status]);
}

function debugNodeTitleDetail(events: StoredThreadEvent[], t: RendererTranslate): string {
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
        return t(messageRoleLabelKeys[event.payload.message.role]);
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
