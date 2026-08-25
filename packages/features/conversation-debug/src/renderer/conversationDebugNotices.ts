import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { RuntimeDebugTraceEvent } from '../contracts/index.js';
import type { ConversationDebugRecord } from './conversationDebugGraph.js';
import { sanitizeConversationDebugText } from './conversationDebugSerialization.js';
import { isRuntimeDebugTrace } from './conversationDebugTraces.js';

export type ConversationDebugDiagnosticTone = 'error' | 'info' | 'warning';

export type ConversationDebugDiagnosticNotice = Readonly<{
  code?: string;
  id: string;
  message: string;
  title: string;
  tone: ConversationDebugDiagnosticTone;
}>;

type MutableNotice = Omit<ConversationDebugDiagnosticNotice, 'id'>;

const WARNING_REPLAY_REASONS = new Set([
  'context_mismatch',
  'legacy_provider_mismatch',
  'native_envelope_invalid',
  'semantic_mismatch',
]);

export function collectConversationDebugNotices(
  records: readonly ConversationDebugRecord[],
  t: RendererTranslate,
): ConversationDebugDiagnosticNotice[] {
  const notices = new Map<string, MutableNotice>();
  const add = (notice: MutableNotice) => {
    const message = clipNoticeText(sanitizeConversationDebugText(notice.message));
    if (!message) return;
    const code = notice.code ? sanitizeConversationDebugText(notice.code) : undefined;
    const key = `${notice.tone}:${code ?? ''}:${message}`;
    if (notices.has(key)) return;
    const sameMessageEntry = [...notices.entries()].find(([, current]) => (
      current.tone === notice.tone && current.message === message
    ));
    // A contextual notice wins over the generic recursive `error`/`warnings` fallback.
    if (sameMessageEntry && !code) return;
    if (sameMessageEntry && code && !sameMessageEntry[1].code) {
      notices.delete(sameMessageEntry[0]);
    }
    notices.set(key, { ...notice, code, message });
  };

  const replayReasons = new Map<string, number>();
  for (const record of records) {
    if (isRuntimeDebugTrace(record)) {
      collectTraceNotices(record, replayReasons, add, t);
    } else {
      collectEventNotices(record, add, t);
    }
    // Unknown additive Feature payloads still surface conventional error/warnings fields.
    collectPayloadIssueNotices(record.payload, add, t);
  }
  for (const [reason, count] of replayReasons) {
    add({
      code: reason,
      message: t('feature.conversationDebug.inspector.notice.replayWarningMessage', { count }),
      title: t('feature.conversationDebug.inspector.notice.replayWarning'),
      tone: 'warning',
    });
  }
  return [...notices.entries()].map(([id, notice]) => ({ id, ...notice }));
}

function collectEventNotices(
  event: StoredThreadEvent,
  add: (notice: MutableNotice) => void,
  t: RendererTranslate,
): void {
  switch (event.type) {
    case 'runtime.error':
      add({ code: event.payload.code, message: event.payload.message, title: t('feature.conversationDebug.inspector.notice.runtimeError'), tone: 'error' });
      break;
    case 'runtime.warning':
      add({ code: event.payload.code, message: event.payload.message, title: t('feature.conversationDebug.inspector.notice.runtimeWarning'), tone: 'warning' });
      break;
    case 'turn.cancelled':
      add({ message: event.payload.reason ?? t('feature.conversationDebug.inspector.notice.noReason'), title: t('feature.conversationDebug.inspector.notice.turnCancelled'), tone: 'warning' });
      break;
    case 'message.created':
      if (event.payload.message.error) {
        add({ message: event.payload.message.error, title: t('feature.conversationDebug.inspector.notice.messageError'), tone: 'error' });
      }
      break;
    case 'item.completed':
      if (event.payload.item.status === 'failed' || event.payload.item.status === 'cancelled') {
        add({
          message: firstNonEmptyText(
            event.payload.content,
            event.payload.item.content,
            event.payload.item.name,
            event.payload.item.kind,
          ),
          title: t(event.payload.item.status === 'failed'
            ? 'feature.conversationDebug.inspector.notice.itemFailed'
            : 'feature.conversationDebug.inspector.notice.itemCancelled'),
          tone: event.payload.item.status === 'failed' ? 'error' : 'warning',
        });
      }
      break;
    case 'tool.completed':
      if (event.payload.status !== 'success') {
        add({
          message: firstNonEmptyText(
            event.payload.resultPreview,
            event.payload.content,
            t('feature.conversationDebug.inspector.notice.noErrorDetail'),
          ),
          title: t(event.payload.status === 'error'
            ? 'feature.conversationDebug.inspector.notice.toolFailed'
            : 'feature.conversationDebug.inspector.notice.toolRejected', {
            tool: event.payload.toolName,
          }),
          tone: event.payload.status === 'error' ? 'error' : 'warning',
        });
      }
      break;
    case 'hook.completed':
      collectHookNotices(event, add, t);
      break;
    case 'approval.resolved':
      collectApprovalNotices(event, add, t);
      break;
    case 'model.verification':
      for (const warning of event.payload.verification.warnings ?? []) {
        add({ message: warning, title: t('feature.conversationDebug.inspector.notice.modelWarning'), tone: 'warning' });
      }
      break;
    case 'safety.buffering':
      for (const reason of event.payload.buffering.reasons ?? []) {
        add({ message: reason, title: t('feature.conversationDebug.inspector.notice.safetyReason'), tone: 'info' });
      }
      break;
    default:
      break;
  }
}

function collectHookNotices(
  event: Extract<StoredThreadEvent, { type: 'hook.completed' }>,
  add: (notice: MutableNotice) => void,
  t: RendererTranslate,
): void {
  const hook = event.payload;
  if (hook.status === 'failed' || hook.status === 'blocked' || hook.status === 'stopped') {
    add({
      message: firstNonEmptyText(
        hook.message,
        hook.stderrPreview,
        hook.statusMessage ?? undefined,
        hook.status,
      ),
      title: t('feature.conversationDebug.inspector.notice.hookIssue', { hook: hook.eventName }),
      tone: hook.status === 'failed' ? 'error' : 'warning',
    });
  }
  for (const entry of hook.entries ?? []) {
    if (entry.kind === 'error' || entry.kind === 'warning' || entry.kind === 'stop') {
      add({
        code: entry.kind,
        message: entry.text,
        title: t('feature.conversationDebug.inspector.notice.hookIssue', { hook: hook.eventName }),
        tone: entry.kind === 'error' ? 'error' : 'warning',
      });
    }
  }
}

function collectApprovalNotices(
  event: Extract<StoredThreadEvent, { type: 'approval.resolved' }>,
  add: (notice: MutableNotice) => void,
  t: RendererTranslate,
): void {
  if (event.payload.decision === 'reject' || event.payload.decision === 'cancel') {
    add({
      code: event.payload.assessment?.status,
      message: firstNonEmptyText(
        event.payload.message,
        event.payload.assessment?.rationale,
        event.payload.decision,
      ),
      title: t('feature.conversationDebug.inspector.notice.approvalIssue'),
      tone: 'warning',
    });
  }
  if (event.payload.assessment?.status === 'failed' || event.payload.assessment?.status === 'timed_out') {
    add({
      code: event.payload.assessment.status,
      message: event.payload.assessment.rationale,
      title: t('feature.conversationDebug.inspector.notice.approvalReviewIssue'),
      tone: event.payload.assessment.status === 'failed' ? 'error' : 'warning',
    });
  }
}

function collectTraceNotices(
  trace: RuntimeDebugTraceEvent,
  replayReasons: Map<string, number>,
  add: (notice: MutableNotice) => void,
  t: RendererTranslate,
): void {
  switch (trace.kind) {
    case 'model.history.normalized':
      for (const warning of trace.payload.warnings) {
        add({ message: warning, title: t('feature.conversationDebug.inspector.notice.historyWarning'), tone: 'warning' });
      }
      if (trace.payload.orphanToolResultMessageIds.length) {
        add({
          code: 'orphan_tool_results',
          message: t('feature.conversationDebug.inspector.notice.orphanResults', { count: trace.payload.orphanToolResultMessageIds.length }),
          title: t('feature.conversationDebug.inspector.notice.historyWarning'),
          tone: 'warning',
        });
      }
      if (trace.payload.interruptedToolResultMessageIds.length) {
        add({
          code: 'interrupted_tool_results',
          message: t('feature.conversationDebug.inspector.notice.interruptedResults', { count: trace.payload.interruptedToolResultMessageIds.length }),
          title: t('feature.conversationDebug.inspector.notice.historyWarning'),
          tone: 'warning',
        });
      }
      break;
    case 'provider.replay.decision':
      if (WARNING_REPLAY_REASONS.has(trace.payload.reason)) {
        replayReasons.set(trace.payload.reason, (replayReasons.get(trace.payload.reason) ?? 0) + 1);
      }
      break;
    case 'context.compaction.native':
    case 'context.compaction.portable':
    case 'context.compaction.completed':
      if (trace.payload.error || trace.payload.outcome === 'error' || trace.payload.outcome === 'fallback') {
        add({
          code: trace.payload.outcome,
          message: trace.payload.error ?? t('feature.conversationDebug.inspector.notice.compactionFallback'),
          title: t('feature.conversationDebug.inspector.notice.compactionIssue'),
          tone: trace.payload.outcome === 'error' ? 'error' : 'warning',
        });
      }
      break;
    case 'stream.pipeline.summary':
      if (trace.payload.terminalEventType !== 'turn.completed') {
        add({
          code: trace.payload.terminalEventType,
          message: t('feature.conversationDebug.inspector.notice.streamFailureMessage'),
          title: t('feature.conversationDebug.inspector.notice.streamFailure'),
          tone: trace.payload.terminalEventType === 'runtime.error' ? 'error' : 'warning',
        });
      }
      break;
  }
}

function collectPayloadIssueNotices(
  payload: unknown,
  add: (notice: MutableNotice) => void,
  t: RendererTranslate,
  depth = 0,
): void {
  if (!payload || typeof payload !== 'object' || depth >= 5) return;
  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = key.replace(/[^a-z]/giu, '').toLowerCase();
    if (normalizedKey === 'error' && typeof value === 'string' && value.trim()) {
      add({ message: value, title: t('feature.conversationDebug.inspector.notice.genericError'), tone: 'error' });
      continue;
    }
    if (normalizedKey === 'warnings' && Array.isArray(value)) {
      for (const warning of value) {
        if (typeof warning === 'string' && warning.trim()) {
          add({ message: warning, title: t('feature.conversationDebug.inspector.notice.genericWarning'), tone: 'warning' });
        }
      }
      continue;
    }
    collectPayloadIssueNotices(value, add, t, depth + 1);
  }
}

function clipNoticeText(value: string): string {
  const maxLength = 2_000;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n…[${value.length - maxLength} chars omitted]`;
}

function firstNonEmptyText(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim()) ?? '';
}
