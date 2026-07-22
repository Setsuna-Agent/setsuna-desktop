import type { RuntimeEvent } from '../events.js';
import type { RuntimeMailboxDeliveryRecord, RuntimeThread } from '../threads.js';
import {
  contextCompactionItem,
  contextCompactionItemId,
  planItem,
  reviewModeItem
} from './items.js';
import type {
  RuntimeSweTurnEntry,
  SweMapperState
} from './mapper-state.js';
import {
  commandActionsForShellCommand,
  compareNullableMs,
  minPositiveMs,
  recordFromJson,
  stringField,
  sweAdditionalPermissionProfile,
  sweCommandExecutionApprovalDecisions,
  sweNetworkApprovalContext,
  swePermissionProfile,
  toEpochMs,
  toEpochSeconds
} from './mapper-utils.js';
import {
  appendAssistantMessageDelta,
  appendPlanItemText,
  assistantMessageStream,
  clearAssistantMessageStream,
  clearTurnState,
  ensurePlanItemStarted,
  ensureReasoningItemStarted,
  fileChangePatchUpdatedNotification,
  hasItemTranscriptMessage,
  isPlanMessage,
  markApprovalPending,
  markApprovalResolved,
  markSystemError,
  markTurnFinished,
  markTurnRunning,
  rememberedStreamItem,
  rememberItemTranscriptMessage,
  rememberPlanMessage,
  rememberPlanMessageItem,
  rememberStreamItem,
  rememberTurnPlanItem,
  shouldEmitItemStarted,
  startAssistantMessageStream,
  streamItemDeltaNotifications,
  threadStatusChangedNotifications,
  turnDiffKey
} from './stream-mapper.js';
import { FILE_MUTATION_TOOL_NAMES, SHELL_TOOL_NAMES } from './tool-names.js';
import {
  appendPlanMessageDelta,
  collabToolCallItemFromMailbox,
  compareRuntimeSweTurnEntries,
  completedAssistantContentNotifications,
  completedLiveSweTurn,
  completedPlanMessageNotifications,
  fileUpdateChangesFromPreview,
  liveSweTurn,
  runtimeEntriesToSweTurn,
  sweItemFromRuntimeStreamItem,
  sweTurnStepSnapshot,
  threadTokenUsage,
  toolCompletedItem,
  toolStartedItem,
  unifiedDiffFromChanges,
  updateTurnDiff
} from './turn-mapper.js';
import type { SweNotification, SweTurn } from './types.js';

export function createSweNotificationMapper(): (event: RuntimeEvent) => SweNotification[] {
  const state: SweMapperState = {
    assistantStreams: new Map(),
    itemTranscriptMessageIds: new Set(),
    turnDiffs: new Map(),
    turnStartedAtMs: new Map(),
    streamItems: new Map(),
    startedItems: new Set(),
    tokenUsageTotals: new Map(),
    threadStatuses: new Map(),
    threadRuntime: new Map(),
    planMessageIds: new Set(),
    planItemsByMessageId: new Map(),
    turnPlanItemIds: new Map(),
  };
  return (event) => runtimeEventToSweNotifications(event, state);
}

export function runtimeEventsToSweNotifications(events: RuntimeEvent[]): SweNotification[] {
  const mapEvent = createSweNotificationMapper();
  return events.flatMap((event) => mapEvent(event));
}

export function runtimeThreadToSweTurns(thread: RuntimeThread): SweTurn[] {
  const groups = new Map<string, RuntimeSweTurnEntry[]>();
  for (const [index, message] of thread.messages.entries()) {
    if (message.visibility === 'model') continue;
    if (!message.turnId) continue;
    groups.set(message.turnId, [...(groups.get(message.turnId) ?? []), { createdAt: message.createdAt, index, message }]);
  }
  const messageCount = thread.messages.length;
  for (const [index, mailbox] of (thread.mailboxDeliveries ?? []).entries()) {
    if (!mailbox.turnId) continue;
    groups.set(mailbox.turnId, [
      ...(groups.get(mailbox.turnId) ?? []),
      { createdAt: mailbox.createdAt, index: messageCount + index, mailbox },
    ]);
  }
  const mailboxCount = thread.mailboxDeliveries?.length ?? 0;
  for (const [index, turn] of (thread.turns ?? []).entries()) {
    groups.set(turn.id, [
      ...(groups.get(turn.id) ?? []),
      {
        createdAt: turn.startedAt ?? turn.completedAt ?? thread.createdAt,
        index: messageCount + mailboxCount + index,
        turn,
      },
    ]);
  }
  return [...groups.entries()]
    .map(([turnId, entries]) => ({
      firstIndex: Math.min(...entries.map((entry) => entry.index)),
      entries: [...entries].sort(compareRuntimeSweTurnEntries),
      startedAtMs: minPositiveMs(entries.map((entry) => toEpochMs(entry.createdAt))),
      turnId,
    }))
    .sort((left, right) => compareNullableMs(left.startedAtMs, right.startedAtMs) || left.firstIndex - right.firstIndex)
    .map(({ turnId, entries }) => runtimeEntriesToSweTurn(thread.id, turnId, entries));
}

export function runtimeEventToSweNotifications(event: RuntimeEvent, state?: SweMapperState): SweNotification[] {
  const turnId = event.turnId ?? '';

  if (event.type === 'thread.created') {
    return [{
      method: 'thread/started',
      params: {
        thread: {
          id: event.threadId,
          sessionId: event.threadId,
          forkedFromId: null,
          parentThreadId: null,
          preview: '',
          ephemeral: false,
          modelProvider: 'setsuna',
          createdAt: toEpochSeconds(event.createdAt),
          updatedAt: toEpochSeconds(event.createdAt),
          recencyAt: toEpochSeconds(event.createdAt),
          status: { type: 'notLoaded' },
          path: null,
          cwd: '.',
          cliVersion: '',
          source: 'appServer',
          threadSource: null,
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: event.payload.title,
          turns: [],
        },
      },
    }];
  }

  if (event.type === 'thread.updated') {
    const notifications: SweNotification[] = [];
    if (event.payload.title !== undefined) {
      notifications.push({
        method: 'thread/name/updated',
        params: { threadId: event.threadId, threadName: event.payload.title },
      });
    }
    if (event.payload.archived === true) {
      notifications.push({ method: 'thread/archived', params: { threadId: event.threadId } });
    }
    if (event.payload.archived === false) {
      notifications.push({ method: 'thread/unarchived', params: { threadId: event.threadId } });
    }
    return notifications;
  }

  if (event.type === 'thread.deleted') {
    return [{ method: 'thread/deleted', params: { threadId: event.threadId } }];
  }

  if (event.type === 'thread.goal_updated') {
    return [{
      method: 'thread/goal/updated',
      params: {
        threadId: event.threadId,
        turnId: event.turnId ?? null,
        goal: { ...event.payload.goal },
      },
    }];
  }

  if (event.type === 'thread.goal_cleared') {
    return event.payload.cleared ? [{ method: 'thread/goal/cleared', params: { threadId: event.threadId } }] : [];
  }

  if (event.type === 'thread.context_compacting') {
    if (!turnId) return [];
    return [{
      method: 'item/started',
      params: {
        threadId: event.threadId,
        turnId,
        item: contextCompactionItem(contextCompactionItemId(turnId)),
        startedAtMs: toEpochMs(event.createdAt),
      },
    }];
  }

  if (event.type === 'thread.context_compacted') {
    if (!turnId) return [];
    return [
      {
        method: 'item/completed',
        params: {
          threadId: event.threadId,
          turnId,
          item: contextCompactionItem(contextCompactionItemId(turnId)),
          completedAtMs: toEpochMs(event.createdAt),
        },
      },
      {
        method: 'thread/compacted',
        params: { threadId: event.threadId, turnId },
      },
    ];
  }

  if (event.type === 'turn.started') {
    if (turnId) {
      state?.turnDiffs.set(turnDiffKey(event.threadId, turnId), '');
      state?.turnStartedAtMs.set(turnDiffKey(event.threadId, turnId), toEpochMs(event.createdAt));
      markTurnRunning(state, event.threadId, turnId);
    }
    return [
      ...threadStatusChangedNotifications(state, event.threadId),
      {
      method: 'turn/started',
      params: {
        threadId: event.threadId,
        turn: liveSweTurn(turnId, 'inProgress', toEpochMs(event.createdAt), null),
      },
      },
    ];
  }

  if (event.type === 'turn.step_snapshot') {
    if (!turnId) return [];
    return [{
      method: 'turn/stepSnapshot/updated',
      params: {
        threadId: event.threadId,
        turnId,
        stepSnapshot: sweTurnStepSnapshot(event.createdAt, event.payload.snapshot),
      },
    }];
  }

  if (event.type === 'mailbox.delivered') {
    if (!turnId) return [];
    const timestampMs = toEpochMs(event.createdAt);
    const record: RuntimeMailboxDeliveryRecord = {
      ...event.payload,
      createdAt: event.createdAt,
      turnId,
    };
    const started = collabToolCallItemFromMailbox(record, 'inProgress', event.threadId);
    const completed = collabToolCallItemFromMailbox(record, 'completed', event.threadId);
    return [
      {
        method: 'item/started',
        params: { threadId: event.threadId, turnId, item: started, startedAtMs: timestampMs },
      },
      {
        method: 'item/completed',
        params: { threadId: event.threadId, turnId, item: completed, completedAtMs: timestampMs },
      },
    ];
  }

  if (event.type === 'turn.completed') {
    const turn = completedLiveSweTurn(state, event.threadId, turnId, 'completed', toEpochMs(event.createdAt));
    if (turnId) markTurnFinished(state, event.threadId, turnId);
    if (turnId) clearTurnState(state, event.threadId, turnId);
    return [
      {
        method: 'turn/completed',
        params: { threadId: event.threadId, turn },
      },
      ...threadStatusChangedNotifications(state, event.threadId),
    ];
  }

  if (event.type === 'turn.cancelled') {
    const turn = completedLiveSweTurn(state, event.threadId, turnId, 'interrupted', toEpochMs(event.createdAt));
    if (turnId) markTurnFinished(state, event.threadId, turnId);
    if (turnId) clearTurnState(state, event.threadId, turnId);
    return [
      {
        method: 'turn/completed',
        params: { threadId: event.threadId, turn },
      },
      ...threadStatusChangedNotifications(state, event.threadId),
    ];
  }

  if (event.type === 'runtime.error') {
    const turn = completedLiveSweTurn(state, event.threadId, turnId, 'failed', toEpochMs(event.createdAt));
    if (turnId) markTurnFinished(state, event.threadId, turnId);
    if (!turnId) markSystemError(state, event.threadId);
    if (turnId) clearTurnState(state, event.threadId, turnId);
    return turnId
      ? [
          {
          method: 'turn/completed',
          params: { threadId: event.threadId, turn },
          },
          ...threadStatusChangedNotifications(state, event.threadId),
        ]
      : threadStatusChangedNotifications(state, event.threadId);
  }

  if (event.type === 'runtime.warning') return [];

  if (event.type === 'message.created') {
    const message = event.payload.message;
    if (message.visibility === 'model') return [];
    if (!turnId || message.role === 'tool') return [];
    if (message.role === 'system' || message.role === 'developer') {
      if (!message.reviewMode) return [];
      const item = reviewModeItem(turnId, message.reviewMode);
      const timestampMs = toEpochMs(event.createdAt);
      return [
        {
          method: 'item/started',
          params: {
            threadId: event.threadId,
            turnId,
            item,
            startedAtMs: timestampMs,
          },
        },
        {
          method: 'item/completed',
          params: {
            threadId: event.threadId,
            turnId,
            item,
            completedAtMs: timestampMs,
          },
        },
      ];
    }
    if (message.role === 'user') {
      return [{
        method: 'item/started',
        params: {
          threadId: event.threadId,
          turnId,
          item: { type: 'userMessage', id: message.id, clientId: message.clientId ?? null, content: [{ type: 'text', text: message.content }] },
          startedAtMs: toEpochMs(event.createdAt),
        },
      }];
    }
    if (message.planMode) {
      rememberPlanMessage(state, event.threadId, turnId, message.id);
      if (message.status === 'streaming') return [];
      const item = planItem(message.id, message.content, message.planMode.status);
      rememberPlanMessageItem(state, event.threadId, message.id, item);
      return [{
        method: 'item/completed',
        params: { threadId: event.threadId, turnId, item, completedAtMs: toEpochMs(event.createdAt) },
      }];
    }
    if (message.status === 'streaming') {
      return startAssistantMessageStream(state, event.threadId, turnId, message.id, message.content, toEpochMs(event.createdAt));
    }
    return completedAssistantContentNotifications(event.threadId, turnId, message.id, message.content, toEpochMs(event.createdAt), message.memoryCitation ?? null);
  }

  if (event.type === 'message.delta') {
    if (!turnId) return [];
    if (hasItemTranscriptMessage(state, event.threadId, turnId, event.payload.messageId)) return [];
    if (isPlanMessage(state, event.threadId, turnId, event.payload.messageId)) {
      return appendPlanMessageDelta(state, event.threadId, turnId, event.payload.messageId, event.payload.text, toEpochMs(event.createdAt));
    }
    return appendAssistantMessageDelta(state, event.threadId, turnId, event.payload.messageId, event.payload.text, toEpochMs(event.createdAt));
  }

  if (event.type === 'message.completed') {
    if (!turnId) return [];
    if (event.payload.planMode) {
      clearAssistantMessageStream(state, event.threadId, turnId, event.payload.messageId);
      return completedPlanMessageNotifications(state, event.threadId, turnId, event.payload.messageId, event.payload.content ?? '', event.payload.planMode, toEpochMs(event.createdAt));
    }
    if (hasItemTranscriptMessage(state, event.threadId, turnId, event.payload.messageId)) {
      clearAssistantMessageStream(state, event.threadId, turnId, event.payload.messageId);
      return [];
    }
    const stream = assistantMessageStream(state, event.threadId, turnId, event.payload.messageId);
    if (!stream) return [];
    clearAssistantMessageStream(state, event.threadId, turnId, event.payload.messageId);
    return completedAssistantContentNotifications(event.threadId, turnId, event.payload.messageId, stream.text, toEpochMs(event.createdAt), event.payload.memoryCitation ?? null);
  }

  if (event.type === 'item.started') {
    if (!turnId) return [];
    rememberItemTranscriptMessage(state, event.threadId, turnId, event.payload.item);
    const item = sweItemFromRuntimeStreamItem(event.payload.item);
    if (!item) return [];
    rememberStreamItem(state, event.threadId, turnId, item);
    if (!shouldEmitItemStarted(state, event.threadId, turnId, item.id)) return [];
    return [{
      method: 'item/started',
      params: {
        threadId: event.threadId,
        turnId,
        item,
        startedAtMs: toEpochMs(event.createdAt),
      },
    }];
  }

  if (event.type === 'item.delta') {
    if (!turnId) return [];
    const item = rememberedStreamItem(state, event.threadId, turnId, event.payload.itemId);
    return streamItemDeltaNotifications(event.threadId, turnId, event.payload.itemId, item, event.payload.delta, toEpochMs(event.createdAt), state);
  }

  if (event.type === 'item.completed') {
    if (!turnId) return [];
    const item = sweItemFromRuntimeStreamItem(event.payload.item);
    if (!item) return [];
    rememberStreamItem(state, event.threadId, turnId, item);
    return [{
      method: 'item/completed',
      params: {
        threadId: event.threadId,
        turnId,
        item,
        completedAtMs: toEpochMs(event.createdAt),
      },
    }];
  }

  if (event.type === 'plan.delta') {
    if (!turnId) return [];
    rememberTurnPlanItem(state, event.threadId, turnId, event.payload.itemId);
    const started = ensurePlanItemStarted(state, event.threadId, turnId, event.payload.itemId, toEpochMs(event.createdAt));
    appendPlanItemText(state, event.threadId, turnId, event.payload.itemId, event.payload.delta);
    return [
      ...started,
      {
        method: 'item/plan/delta',
        params: { threadId: event.threadId, turnId, itemId: event.payload.itemId, delta: event.payload.delta },
      },
    ];
  }

  if (event.type === 'reasoning.summary_delta') {
    if (!turnId) return [];
    return [
      ...ensureReasoningItemStarted(state, event.threadId, turnId, event.payload.itemId, toEpochMs(event.createdAt)),
      {
        method: 'item/reasoning/summaryTextDelta',
        params: {
          threadId: event.threadId,
          turnId,
          itemId: event.payload.itemId,
          delta: event.payload.delta,
          summaryIndex: event.payload.summaryIndex ?? 0,
        },
      },
    ];
  }

  if (event.type === 'reasoning.summary_part_added') {
    if (!turnId) return [];
    return [
      ...ensureReasoningItemStarted(state, event.threadId, turnId, event.payload.itemId, toEpochMs(event.createdAt)),
      {
        method: 'item/reasoning/summaryPartAdded',
        params: {
          threadId: event.threadId,
          turnId,
          itemId: event.payload.itemId,
          summaryIndex: event.payload.summaryIndex ?? 0,
        },
      },
    ];
  }

  if (event.type === 'reasoning.raw_delta') {
    if (!turnId) return [];
    return [
      ...ensureReasoningItemStarted(state, event.threadId, turnId, event.payload.itemId, toEpochMs(event.createdAt)),
      {
        method: 'item/reasoning/textDelta',
        params: {
          threadId: event.threadId,
          turnId,
          itemId: event.payload.itemId,
          delta: event.payload.delta,
          contentIndex: event.payload.contentIndex ?? 0,
        },
      },
    ];
  }

  if (event.type === 'safety.buffering') {
    if (!turnId) return [];
    const buffering = event.payload.buffering;
    return [{
      method: 'model/safetyBuffering/updated',
      params: {
        threadId: event.threadId,
        turnId,
        model: buffering.model ?? '',
        useCases: buffering.useCases ?? [],
        reasons: buffering.reasons ?? [],
        showBufferingUi: buffering.showBufferingUi ?? false,
        fasterModel: buffering.fasterModel ?? null,
      },
    }];
  }

  if (event.type === 'model.verification') {
    if (!turnId) return [];
    return [{
      method: 'model/verification',
      params: {
        threadId: event.threadId,
        turnId,
        verifications: [event.payload.verification],
      },
    }];
  }

  if (event.type === 'token.count') {
    if (!turnId) return [];
    return [{
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: event.threadId,
        turnId,
        tokenUsage: threadTokenUsage(state, event.threadId, event.payload.usage, event.payload.modelContextWindow),
      },
    }];
  }

  if (event.type === 'turn.diff') {
    if (!turnId) return [];
    const diff = updateTurnDiff(state, event.threadId, turnId, event.payload.unifiedDiff);
    return diff
      ? [{
          method: 'turn/diff/updated',
          params: { threadId: event.threadId, turnId, diff },
        }]
      : [];
  }

  if (event.type === 'tool.preview' || event.type === 'tool.started') {
    if (!turnId) return [];
    const item = toolStartedItem(event.payload.toolCallId, event.payload.toolName, event.payload.argumentsPreview, event.payload.resultPreview, event.payload.source);
    const notifications: SweNotification[] = [];
    if (shouldEmitItemStarted(state, event.threadId, turnId, item.id)) {
      notifications.push({
        method: 'item/started',
        params: {
          threadId: event.threadId,
          turnId,
          item,
          startedAtMs: toEpochMs(event.createdAt),
        },
      });
    }
    if (item.type === 'fileChange' && item.changes.length) {
      notifications.push(fileChangePatchUpdatedNotification(event.threadId, turnId, item.id, item.changes));
    }
    return notifications;
  }

  if (event.type === 'tool.output_delta') {
    if (!turnId || !SHELL_TOOL_NAMES.has(event.payload.toolName) || !event.payload.delta) return [];
    return [{
      method: 'item/commandExecution/outputDelta',
      params: {
        threadId: event.threadId,
        turnId,
        itemId: event.payload.toolCallId,
        delta: event.payload.delta,
      },
    }];
  }

  if (event.type === 'tool.completed') {
    if (!turnId) return [];
    const item = toolCompletedItem(event.payload.toolCallId, event.payload);
    const notifications: SweNotification[] = [{
      method: 'item/completed',
      params: {
        threadId: event.threadId,
        turnId,
        item,
        completedAtMs: toEpochMs(event.createdAt),
      },
    }];
    if (item.type === 'fileChange' && item.status === 'completed' && item.changes.length) {
      const diff = updateTurnDiff(state, event.threadId, turnId, unifiedDiffFromChanges(item.changes));
      if (diff) notifications.push({
        method: 'turn/diff/updated',
        params: { threadId: event.threadId, turnId, diff },
      });
    }
    return notifications;
  }

  if (event.type === 'approval.requested' && FILE_MUTATION_TOOL_NAMES.has(event.payload.approval.toolName)) {
    const approval = event.payload.approval;
    const changes = fileUpdateChangesFromPreview(approval.argumentsPreview);
    const notifications: SweNotification[] = [];
    markApprovalPending(state, event.threadId, approval.id);
    if (changes.length) notifications.push(fileChangePatchUpdatedNotification(event.threadId, turnId, approval.toolCallId, changes));
    notifications.push({
      method: 'item/fileChange/requestApproval',
      id: approval.id,
      params: {
        threadId: event.threadId,
        turnId,
        itemId: approval.toolCallId,
        startedAtMs: toEpochMs(approval.createdAt),
        reason: approval.reason,
        grantRoot: null,
      },
    });
    notifications.push(...threadStatusChangedNotifications(state, event.threadId));
    return notifications;
  }

  if (event.type === 'approval.requested' && event.payload.approval.toolName === 'request_permissions') {
    const approval = event.payload.approval;
    const permissionContext = approval.permissionApprovalContext;
    const params = {
      threadId: event.threadId,
      turnId,
      itemId: approval.toolCallId,
      environmentId: permissionContext?.environmentId ?? null,
      startedAtMs: toEpochMs(approval.createdAt),
      cwd: permissionContext?.cwd ?? '',
      reason: permissionContext?.reason ?? approval.reason ?? null,
      permissions: swePermissionProfile(permissionContext?.requestedPermissions),
    };
    markApprovalPending(state, event.threadId, approval.id);
    return [
      {
        method: 'item/permissions/requestApproval',
        id: approval.id,
        params,
      },
      ...threadStatusChangedNotifications(state, event.threadId),
    ];
  }

  if (event.type === 'approval.requested' && SHELL_TOOL_NAMES.has(event.payload.approval.toolName)) {
    const approval = event.payload.approval;
    const args = recordFromJson(approval.argumentsPreview);
    const availableDecisions = sweCommandExecutionApprovalDecisions(approval.availableDecisions);
    const additionalPermissions = sweAdditionalPermissionProfile(approval.additionalPermissions);
    const command = stringField(args.command ?? args.cmd) || null;
    const cwd = stringField(args.directory ?? args.workdir) || null;
    markApprovalPending(state, event.threadId, approval.id);
    return [
      {
        method: 'item/commandExecution/requestApproval',
        id: approval.id,
        params: {
          threadId: event.threadId,
          turnId,
          itemId: approval.toolCallId,
          startedAtMs: toEpochMs(approval.createdAt),
          approvalId: null,
          environmentId: approval.environmentId ?? null,
          reason: approval.reason,
          networkApprovalContext: sweNetworkApprovalContext(approval.networkApprovalContext),
          command,
          cwd,
          commandActions: commandActionsForShellCommand(command, cwd ?? '.'),
          ...(additionalPermissions ? { additionalPermissions } : {}),
          proposedExecpolicyAmendment: approval.proposedExecPolicyAmendment ?? null,
          proposedNetworkPolicyAmendments: approval.proposedNetworkPolicyAmendments ?? null,
          ...(availableDecisions ? { availableDecisions } : {}),
        },
      },
      ...threadStatusChangedNotifications(state, event.threadId),
    ];
  }

  if (event.type === 'approval.resolved') {
    markApprovalResolved(state, event.threadId, event.payload.approvalId);
    return [
      {
        method: 'serverRequest/resolved',
        params: { threadId: event.threadId, requestId: event.payload.approvalId },
      },
      ...threadStatusChangedNotifications(state, event.threadId),
    ];
  }

  if (event.type === 'message.plan_mode_updated') {
    if (!turnId) return [];
    return completedPlanMessageNotifications(state, event.threadId, turnId, event.payload.messageId, event.payload.content ?? '', event.payload.planMode, toEpochMs(event.createdAt));
  }

  return [];
}
