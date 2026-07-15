import type { RuntimeEvent } from './events.js';
import type { RuntimeGitInfo, RuntimeMailboxDeliveryRecord, RuntimeMessage, RuntimeThread, RuntimeThreadGoal, RuntimeThreadTurn, RuntimeToolRun } from './threads.js';
import type { RuntimeDynamicToolContentItem, RuntimeModelRequestStepSnapshot, RuntimeModelVerification, RuntimeSafetyBuffering, RuntimeStreamItem } from './provider.js';
import type { RuntimeUsage } from './usage.js';
import type {
  RuntimeApprovalAvailableDecision,
  RuntimeExecPolicyAmendment,
  RuntimeNetworkApprovalContext,
  RuntimeNetworkPolicyAmendment,
} from './approvals.js';

export type SwePatchApplyStatus = 'inProgress' | 'completed' | 'failed' | 'declined';
export type SwePatchChangeKind = 'add' | 'delete' | 'update';
export type SweCommandExecutionStatus = 'inProgress' | 'completed' | 'failed' | 'declined';
export type SweCommandExecutionSource = 'agent' | 'userShell' | 'unifiedExecStartup' | 'unifiedExecInteraction';
export type SweDynamicToolCallStatus = 'inProgress' | 'completed' | 'failed';
export type SweCollabToolCallStatus = 'inProgress' | 'completed' | 'failed';
export type SweCollabToolName = 'spawn_agent' | 'send_input' | 'resume_agent' | 'wait' | 'close_agent';
export type SweThreadActiveFlag = 'waitingOnApproval' | 'waitingOnUserInput';
export type SweThreadStatus =
  | { type: 'notLoaded' | 'idle' | 'systemError' }
  | { type: 'active'; activeFlags: SweThreadActiveFlag[] };
export type SweTokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};
export type SweThreadTokenUsage = {
  total: SweTokenUsageBreakdown;
  last: SweTokenUsageBreakdown;
  modelContextWindow: number | null;
};

export type SweThreadGoal = RuntimeThreadGoal;

export type SweGitInfo = RuntimeGitInfo;

export type SweNetworkApprovalProtocol = 'http' | 'https' | 'socks5Tcp' | 'socks5Udp';

export type SweNetworkApprovalContext = {
  host: string;
  protocol: SweNetworkApprovalProtocol;
};

export type SweNetworkPolicyAmendment = RuntimeNetworkPolicyAmendment;

export type SweExecPolicyAmendment = RuntimeExecPolicyAmendment;

export type SweAdditionalPermissionProfile = Record<string, unknown>;

export type SweCommandExecutionApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'acceptAndRemember'
  | 'decline'
  | 'cancel'
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: SweExecPolicyAmendment } }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: SweNetworkPolicyAmendment } };

export type SweCommandAction =
  | { type: 'read'; command: string; name: string; path: string }
  | { type: 'listFiles'; command: string; path: string | null }
  | { type: 'search'; command: string; query: string | null; path: string | null }
  | { type: 'unknown'; command: string };

export type SweFileUpdateChange = {
  path: string;
  kind: SwePatchChangeKind;
  diff: string;
};

export type SweThreadItem =
  | {
      type: 'userMessage';
      id: string;
      clientId: string | null;
      content: Array<{ type: 'text'; text: string }>;
    }
  | {
      type: 'agentMessage';
      id: string;
      text: string;
      phase: null;
      memoryCitation: RuntimeMessage['memoryCitation'] | null;
    }
  | {
      type: 'plan';
      id: string;
      text: string;
      status?: NonNullable<RuntimeMessage['planMode']>['status'];
    }
  | {
      type: 'reasoning';
      id: string;
      summary: string[];
      content: string[];
    }
  | {
      type: 'contextCompaction';
      id: string;
    }
  | {
      type: 'enteredReviewMode';
      id: string;
      review: string;
    }
  | {
      type: 'exitedReviewMode';
      id: string;
      review: string;
    }
  | {
      type: 'commandExecution';
      id: string;
      command: string;
      cwd: string;
      processId: string | null;
      source: SweCommandExecutionSource;
      status: SweCommandExecutionStatus;
      commandActions: SweCommandAction[];
      aggregatedOutput: string | null;
      exitCode: number | null;
      durationMs: number | null;
    }
  | {
      type: 'fileChange';
      id: string;
      changes: SweFileUpdateChange[];
      status: SwePatchApplyStatus;
    }
  | {
      type: 'dynamicToolCall';
      id: string;
      namespace: null;
      tool: string;
      arguments: unknown;
      status: SweDynamicToolCallStatus;
      contentItems: RuntimeDynamicToolContentItem[] | null;
      success: boolean | null;
      durationMs: number | null;
    }
  | {
      type: 'collabToolCall';
      id: string;
      tool: SweCollabToolName;
      status: SweCollabToolCallStatus;
      senderThreadId: string;
      receiverThreadId?: string;
      newThreadId?: string;
      prompt?: string;
      agentStatus?: string;
    };

export type SweThread = {
  id: string;
  sessionId: string;
  forkedFromId: string | null;
  parentThreadId: string | null;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: SweThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: 'appServer';
  threadSource: null;
  agentNickname: null;
  agentRole: null;
  gitInfo: SweGitInfo | null;
  name: string | null;
  turns: SweTurn[];
};

export type SweTurnStepSnapshot = {
  createdAtMs: number;
  snapshot: RuntimeModelRequestStepSnapshot;
};

export type SweTurnTokenCount = {
  createdAtMs: number;
  modelContextWindow?: number;
  tokensUntilCompaction?: number;
  usage: RuntimeUsage;
};

export type SweTurn = {
  id: string;
  items: SweThreadItem[];
  itemsView: 'notLoaded' | 'summary' | 'full';
  status: 'inProgress' | 'completed' | 'failed' | 'interrupted';
  error: null;
  diff?: string;
  modelVerifications?: RuntimeModelVerification[];
  safetyBuffering?: RuntimeSafetyBuffering;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  stepSnapshots?: SweTurnStepSnapshot[];
  tokenCounts?: SweTurnTokenCount[];
};

export type SweNotification =
  | {
      method: 'thread/started';
      params: { thread: SweThread };
    }
  | {
      method: 'command/exec/outputDelta';
      params: {
        processId: string;
        stream: 'stdout' | 'stderr';
        deltaBase64: string;
        capReached: boolean;
      };
    }
  | {
      method: 'process/outputDelta';
      params: {
        processHandle: string;
        stream: 'stdout' | 'stderr';
        deltaBase64: string;
        capReached: boolean;
      };
    }
  | {
      method: 'process/exited';
      params: {
        processHandle: string;
        exitCode: number;
        stdout: string;
        stdoutCapReached: boolean;
        stderr: string;
        stderrCapReached: boolean;
      };
    }
  | {
      method: 'fs/changed';
      params: {
        watchId: string;
        changedPaths: string[];
      };
    }
  | {
      method: 'skills/changed';
      params: Record<string, never>;
    }
  | {
      method: 'mcpServer/oauthLogin/completed';
      params: { name: string; threadId: string | null; success: boolean; error?: string };
    }
  | {
      method: 'thread/name/updated';
      params: { threadId: string; threadName?: string };
    }
  | {
      method: 'thread/archived';
      params: { threadId: string };
    }
  | {
      method: 'thread/unarchived';
      params: { threadId: string };
    }
  | {
      method: 'thread/deleted';
      params: { threadId: string };
    }
  | {
      method: 'thread/goal/updated';
      params: { threadId: string; turnId: string | null; goal: SweThreadGoal };
    }
  | {
      method: 'thread/goal/cleared';
      params: { threadId: string };
    }
  | {
      method: 'thread/status/changed';
      params: { threadId: string; status: SweThreadStatus };
    }
  | {
      method: 'thread/tokenUsage/updated';
      params: { threadId: string; turnId: string; tokenUsage: SweThreadTokenUsage };
    }
  | {
      method: 'turn/started';
      params: { threadId: string; turn: SweTurn };
    }
  | {
      method: 'turn/completed';
      params: { threadId: string; turn: SweTurn };
    }
  | {
      method: 'turn/diff/updated';
      params: { threadId: string; turnId: string; diff: string };
    }
  | {
      method: 'turn/stepSnapshot/updated';
      params: { threadId: string; turnId: string; stepSnapshot: SweTurnStepSnapshot };
    }
  | {
      method: 'item/started';
      params: { threadId: string; turnId: string; item: SweThreadItem; startedAtMs: number };
    }
  | {
      method: 'item/completed';
      params: { threadId: string; turnId: string; item: SweThreadItem; completedAtMs: number };
    }
  | {
      method: 'item/agentMessage/delta';
      params: { threadId: string; turnId: string; itemId: string; delta: string };
    }
  | {
      method: 'item/plan/delta';
      params: { threadId: string; turnId: string; itemId: string; delta: string };
    }
  | {
      method: 'item/reasoning/summaryTextDelta';
      params: { threadId: string; turnId: string; itemId: string; delta: string; summaryIndex: number };
    }
  | {
      method: 'item/reasoning/summaryPartAdded';
      params: { threadId: string; turnId: string; itemId: string; summaryIndex: number };
    }
  | {
      method: 'item/reasoning/textDelta';
      params: { threadId: string; turnId: string; itemId: string; delta: string; contentIndex: number };
    }
  | {
      method: 'item/commandExecution/outputDelta';
      params: { threadId: string; turnId: string; itemId: string; delta: string };
    }
  | {
      method: 'item/fileChange/patchUpdated';
      params: { threadId: string; turnId: string; itemId: string; changes: SweFileUpdateChange[] };
    }
  | {
      method: 'item/fileChange/requestApproval';
      id: string;
      params: { threadId: string; turnId: string; itemId: string; startedAtMs: number; reason?: string | null; grantRoot?: string | null };
    }
  | {
      method: 'item/tool/call';
      id: string;
      params: {
        threadId: string;
        turnId: string;
        callId: string;
        namespace: string | null;
        tool: string;
        arguments: unknown;
      };
    }
  | {
      method: 'item/commandExecution/requestApproval';
      id: string;
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        startedAtMs: number;
        approvalId: string | null;
        environmentId: string | null;
        reason?: string | null;
        networkApprovalContext?: SweNetworkApprovalContext | null;
        command?: string | null;
        cwd?: string | null;
        commandActions?: SweCommandAction[];
        additionalPermissions?: SweAdditionalPermissionProfile | null;
        proposedExecpolicyAmendment?: SweExecPolicyAmendment | null;
        proposedNetworkPolicyAmendments?: SweNetworkPolicyAmendment[] | null;
        availableDecisions?: SweCommandExecutionApprovalDecision[] | null;
      };
    }
  | {
      method: 'item/permissions/requestApproval';
      id: string;
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        environmentId?: string | null;
        startedAtMs: number;
        cwd: string;
        reason?: string | null;
        permissions: unknown;
      };
    }
  | {
      method: 'serverRequest/resolved';
      params: { threadId: string; requestId: string | number };
    }
  | {
      method: 'thread/compacted';
      params: { threadId: string; turnId: string };
    }
  | {
      method: 'model/verification';
      params: { threadId: string; turnId: string; verifications: RuntimeModelVerification[] };
    }
  | {
      method: 'model/safetyBuffering/updated';
      params: {
        threadId: string;
        turnId: string;
        model: string;
        useCases: string[];
        reasons: string[];
        showBufferingUi: boolean;
        fasterModel: string | null;
      };
    };

export type SweNotificationClientCapabilities = {
  experimentalApi?: boolean;
};

export function filterSweNotificationForClientCapabilities(
  notification: SweNotification,
  capabilities: SweNotificationClientCapabilities = {},
): SweNotification {
  if (capabilities.experimentalApi === true) return notification;
  if (notification.method !== 'item/commandExecution/requestApproval') return notification;
  if (notification.params.additionalPermissions === undefined) return notification;
  const params = { ...notification.params };
  delete params.additionalPermissions;
  return { ...notification, params };
}

export function filterSweNotificationsForClientCapabilities(
  notifications: SweNotification[],
  capabilities: SweNotificationClientCapabilities = {},
): SweNotification[] {
  if (capabilities.experimentalApi === true) return notifications;
  let changed = false;
  const filtered = notifications.map((notification) => {
    const next = filterSweNotificationForClientCapabilities(notification, capabilities);
    if (next !== notification) changed = true;
    return next;
  });
  return changed ? filtered : notifications;
}

const FILE_MUTATION_TOOL_NAMES = new Set([
  'workspace_write_file',
  'apply_patch',
  'write_file',
  'append_file',
  'delete_file',
  'edit',
  'edit_file',
]);

const SHELL_TOOL_NAMES = new Set(['run_shell_command', 'exec_command', 'write_stdin']);

type SweMapperState = {
  assistantStreams: Map<string, AssistantStreamState>;
  itemTranscriptMessageIds: Set<string>;
  turnDiffs: Map<string, string>;
  turnStartedAtMs: Map<string, number>;
  streamItems: Map<string, SweThreadItem>;
  startedItems: Set<string>;
  tokenUsageTotals: Map<string, SweTokenUsageBreakdown>;
  threadStatuses: Map<string, SweThreadStatus>;
  threadRuntime: Map<string, ThreadRuntimeState>;
  planMessageIds: Set<string>;
  planItemsByMessageId: Map<string, SweThreadItem>;
  turnPlanItemIds: Map<string, string>;
};

type ThreadRuntimeState = {
  runningTurnIds: Set<string>;
  pendingApprovalIds: Set<string>;
  systemError: boolean;
};

type AssistantStreamMode = 'markdown' | 'think';

type AssistantStreamState = {
  text: string;
  mode: AssistantStreamMode;
  currentAgentItemId: string | null;
  currentReasoningItemId: string | null;
  agentSegmentIndex: number;
  reasoningSegmentIndex: number;
};

type AssistantContentSegment = {
  content: string;
  type: AssistantStreamMode;
};

type ToolCompletedPayload = Extract<RuntimeEvent, { type: 'tool.completed' }>['payload'];

type RuntimeSweTurnEntry = {
  createdAt: string;
  index: number;
  message?: RuntimeMessage;
  mailbox?: RuntimeMailboxDeliveryRecord;
  turn?: RuntimeThreadTurn;
};

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

function toolStartedItem(
  id: string,
  toolName: string,
  argumentsPreview: string,
  resultPreview: string | undefined,
  source?: 'agent' | 'userShell',
): SweThreadItem {
  if (FILE_MUTATION_TOOL_NAMES.has(toolName)) {
    return {
      type: 'fileChange',
      id,
      changes: fileUpdateChangesFromPreview(resultPreview ?? argumentsPreview),
      status: 'inProgress',
    };
  }
  if (SHELL_TOOL_NAMES.has(toolName)) {
    const args = recordFromJson(argumentsPreview);
    return commandExecutionItem(id, args, 'inProgress', null, {}, undefined, commandSource(source));
  }
  return dynamicToolItem(id, toolName, recordFromJson(argumentsPreview), 'inProgress', null);
}

function toolCompletedItem(id: string, payload: ToolCompletedPayload): SweThreadItem {
  const { toolName, status } = payload;
  if (FILE_MUTATION_TOOL_NAMES.has(toolName)) {
    return {
      type: 'fileChange',
      id,
      changes: fileUpdateChangesFromPreview(payload.resultPreview ?? payload.content ?? payload.argumentsPreview),
      status: status === 'success' ? 'completed' : status === 'rejected' ? 'declined' : 'failed',
    };
  }
  if (SHELL_TOOL_NAMES.has(toolName)) {
    return commandExecutionItem(
      id,
      recordFromJson(payload.argumentsPreview),
      status === 'success' ? 'completed' : status === 'rejected' ? 'declined' : 'failed',
      payload.content,
      recordInput(payload.data),
      payload.durationMs,
      commandSource(payload.source),
    );
  }
  const dynamicData = dynamicToolData(payload.data);
  return dynamicToolItem(
    id,
    toolName,
    recordFromJson(payload.argumentsPreview),
    status === 'success' ? 'completed' : 'failed',
    dynamicData.success ?? status === 'success',
    payload.durationMs ?? null,
    dynamicData.contentItems,
  );
}

function runtimeEntriesToSweTurn(threadId: string, turnId: string, entries: RuntimeSweTurnEntry[]): SweTurn {
  const messages = entries.map((entry) => entry.message).filter((message): message is RuntimeMessage => Boolean(message));
  const turn = entries.find((entry) => entry.turn)?.turn;
  const streamItems = turn?.items.map(sweItemFromRuntimeStreamItem).filter((item): item is SweThreadItem => Boolean(item)) ?? [];
  const canonicalTranscriptMessageIds = new Set((turn?.items ?? []).map((item) => item.transcriptMessageId).filter((id): id is string => Boolean(id)));
  const canonicalItemIds = new Set(streamItems.map((item) => item.id));
  const items = streamItems.length
    ? dedupeSweItems([
        ...entries.flatMap((entry) => runtimeSweTurnEntryToItems(threadId, entry, canonicalTranscriptMessageIds, canonicalItemIds, { onlyUserMessages: true })),
        ...streamItems,
        ...entries.flatMap((entry) => runtimeSweTurnEntryToItems(threadId, entry, canonicalTranscriptMessageIds, canonicalItemIds, { allowCanonicalToolItems: true, skipUserMessages: true })),
      ])
    : entries.flatMap((entry) => runtimeSweTurnEntryToItems(threadId, entry, canonicalTranscriptMessageIds, canonicalItemIds));
  const startedAt = turn?.startedAt ? toEpochSeconds(turn.startedAt) : minEpochSeconds(entries.map((entry) => entry.createdAt));
  const stepSnapshots = turn?.stepSnapshots?.map((step) => sweTurnStepSnapshot(step.createdAt, step.snapshot));
  const tokenCounts = turn?.tokenCounts?.map((count) => sweTurnTokenCount(count.createdAt, count));
  const turnStatus = sweTurnStatusFromRuntimeTurn(turn?.status);
  const hasError = turnStatus === 'failed' || messages.some((message) => message.status === 'error');
  const inProgress = turnStatus === 'inProgress' || (!turnStatus && messages.some(messageInProgress));
  const completedAt = inProgress
    ? null
    : turn?.completedAt
      ? toEpochSeconds(turn.completedAt)
      : maxEpochSeconds(entries.map((entry) => entry.message?.completedAt ?? entry.turn?.completedAt ?? entry.createdAt));
  const status = turnStatus ?? (hasError ? 'failed' : inProgress ? 'inProgress' : 'completed');
  return {
    id: turnId,
    items,
    itemsView: 'full',
    status,
    error: null,
    startedAt,
    completedAt,
    durationMs: startedAt === null || completedAt === null ? null : Math.max(0, (completedAt - startedAt) * 1000),
    ...(turn?.diff ? { diff: turn.diff } : {}),
    ...(turn?.modelVerifications?.length ? { modelVerifications: turn.modelVerifications.map((verification) => ({ ...verification, warnings: verification.warnings ? [...verification.warnings] : undefined })) } : {}),
    ...(turn?.safetyBuffering ? { safetyBuffering: cloneSafetyBuffering(turn.safetyBuffering) } : {}),
    ...(stepSnapshots?.length ? { stepSnapshots } : {}),
    ...(tokenCounts?.length ? { tokenCounts } : {}),
  };
}

function sweTurnStepSnapshot(createdAt: string, snapshot: RuntimeModelRequestStepSnapshot): SweTurnStepSnapshot {
  return {
    createdAtMs: toEpochMs(createdAt),
    snapshot: cloneRuntimeModelRequestStepSnapshot(snapshot),
  };
}

function cloneRuntimeModelRequestStepSnapshot(snapshot: RuntimeModelRequestStepSnapshot): RuntimeModelRequestStepSnapshot {
  return {
    ...snapshot,
    advertisedToolNames: snapshot.advertisedToolNames ? [...snapshot.advertisedToolNames] : undefined,
    contextWindow: snapshot.contextWindow
      ? {
          ...snapshot.contextWindow,
          compactionSummaryMessageIds: [...snapshot.contextWindow.compactionSummaryMessageIds],
        }
      : undefined,
    conversationMessageIds: [...snapshot.conversationMessageIds],
    deferredToolNames: snapshot.deferredToolNames ? [...snapshot.deferredToolNames] : undefined,
    featureKeys: [...snapshot.featureKeys],
    inputMessageIds: snapshot.inputMessageIds ? [...snapshot.inputMessageIds] : undefined,
    mcpServerKeys: [...snapshot.mcpServerKeys],
    messageIds: [...snapshot.messageIds],
    promptManifest: snapshot.promptManifest ? snapshot.promptManifest.map((entry) => ({ ...entry })) : undefined,
    routerToolNames: snapshot.routerToolNames ? [...snapshot.routerToolNames] : undefined,
    sandboxWorkspaceWrite: snapshot.sandboxWorkspaceWrite
      ? {
          ...snapshot.sandboxWorkspaceWrite,
          deniedGlobPatterns: snapshot.sandboxWorkspaceWrite.deniedGlobPatterns ? [...snapshot.sandboxWorkspaceWrite.deniedGlobPatterns] : undefined,
          deniedRoots: snapshot.sandboxWorkspaceWrite.deniedRoots ? [...snapshot.sandboxWorkspaceWrite.deniedRoots] : undefined,
          readableRoots: snapshot.sandboxWorkspaceWrite.readableRoots ? [...snapshot.sandboxWorkspaceWrite.readableRoots] : undefined,
          writableRoots: snapshot.sandboxWorkspaceWrite.writableRoots ? [...snapshot.sandboxWorkspaceWrite.writableRoots] : undefined,
        }
      : undefined,
    selectedSkills: snapshot.selectedSkills.map((skill) => ({ ...skill })),
    toolEnvironment: snapshot.toolEnvironment
      ? {
          ...snapshot.toolEnvironment,
          repository: snapshot.toolEnvironment.repository ? { ...snapshot.toolEnvironment.repository } : undefined,
          workspaceRoots: snapshot.toolEnvironment.workspaceRoots ? [...snapshot.toolEnvironment.workspaceRoots] : undefined,
        }
      : snapshot.toolEnvironment,
    toolNames: [...snapshot.toolNames],
    toolRuntimes: snapshot.toolRuntimes ? snapshot.toolRuntimes.map((runtime) => ({ ...runtime })) : undefined,
    worldState: { ...snapshot.worldState },
  };
}

function sweTurnTokenCount(
  createdAt: string,
  count: NonNullable<RuntimeThreadTurn['tokenCounts']>[number],
): SweTurnTokenCount {
  return {
    createdAtMs: toEpochMs(createdAt),
    usage: { ...count.usage },
    ...(count.modelContextWindow !== undefined ? { modelContextWindow: count.modelContextWindow } : {}),
    ...(count.tokensUntilCompaction !== undefined ? { tokensUntilCompaction: count.tokensUntilCompaction } : {}),
  };
}

function cloneSafetyBuffering(buffering: RuntimeSafetyBuffering): RuntimeSafetyBuffering {
  return {
    ...buffering,
    reasons: buffering.reasons ? [...buffering.reasons] : undefined,
    useCases: buffering.useCases ? [...buffering.useCases] : undefined,
  };
}

function runtimeSweTurnEntryToItems(
  threadId: string,
  entry: RuntimeSweTurnEntry,
  canonicalTranscriptMessageIds = new Set<string>(),
  canonicalItemIds = new Set<string>(),
  options: { allowCanonicalToolItems?: boolean; onlyUserMessages?: boolean; skipUserMessages?: boolean } = {},
): SweThreadItem[] {
  if (entry.turn) return [];
  if (entry.message) {
    if (options.onlyUserMessages && entry.message.role !== 'user') return [];
    if (options.skipUserMessages && entry.message.role === 'user') return [];
    return runtimeMessageToSweItems(entry.message, {
      skipTranscriptContent: canonicalTranscriptMessageIds.has(entry.message.id),
    }).filter((item) => !canonicalItemIds.has(item.id) || (options.allowCanonicalToolItems && isToolResultSweItem(item)));
  }
  if (entry.mailbox) {
    if (options.onlyUserMessages) return [];
    const item = collabToolCallItemFromMailbox(entry.mailbox, 'completed', threadId);
    return canonicalItemIds.has(item.id) ? [] : [item];
  }
  return [];
}

function sweTurnStatusFromRuntimeTurn(status: RuntimeThreadTurn['status'] | undefined): SweTurn['status'] | null {
  if (status === 'in_progress') return 'inProgress';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'interrupted';
  return null;
}

function dedupeSweItems(items: SweThreadItem[]): SweThreadItem[] {
  const indexes = new Map<string, number>();
  const toolIndexes = new Map<string, number>();
  const result: SweThreadItem[] = [];
  for (const item of items) {
    const toolIndex = isToolResultSweItem(item) ? toolIndexes.get(item.id) : undefined;
    if (toolIndex !== undefined) {
      result[toolIndex] = mergeDuplicateSweItem(result[toolIndex]!, item);
      continue;
    }
    const key = sweItemDedupeKey(item);
    const index = indexes.get(key);
    if (index !== undefined) {
      result[index] = mergeDuplicateSweItem(result[index]!, item);
      if (isToolResultSweItem(result[index]!)) toolIndexes.set(item.id, index);
      continue;
    }
    indexes.set(key, result.length);
    if (isToolResultSweItem(item)) toolIndexes.set(item.id, result.length);
    result.push(item);
  }
  return result;
}

function sweItemDedupeKey(item: SweThreadItem): string {
  return `${item.type}:${item.id}`;
}

function isToolResultSweItem(item: SweThreadItem): boolean {
  return item.type === 'dynamicToolCall' || item.type === 'commandExecution' || item.type === 'fileChange';
}

function mergeDuplicateSweItem(existing: SweThreadItem, incoming: SweThreadItem): SweThreadItem {
  if (isToolResultSweItem(incoming)) {
    if (existing.type === 'dynamicToolCall' && incoming.type === 'dynamicToolCall') {
      return {
        ...existing,
        ...incoming,
        contentItems: incoming.contentItems ?? existing.contentItems,
        durationMs: incoming.durationMs ?? existing.durationMs,
        success: incoming.success ?? existing.success,
      };
    }
    return incoming;
  }
  return existing;
}

function liveSweTurn(
  turnId: string,
  status: SweTurn['status'],
  startedAtMs: number | null,
  completedAtMs: number | null,
): SweTurn {
  const startedAt = startedAtMs && startedAtMs > 0 ? Math.floor(startedAtMs / 1000) : null;
  const completedAt = completedAtMs && completedAtMs > 0 ? Math.floor(completedAtMs / 1000) : null;
  return {
    id: turnId,
    items: [],
    itemsView: 'full',
    status,
    error: null,
    startedAt,
    completedAt,
    durationMs: startedAtMs !== null && completedAtMs !== null ? Math.max(0, completedAtMs - startedAtMs) : null,
  };
}

function completedLiveSweTurn(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  status: Exclude<SweTurn['status'], 'inProgress'>,
  completedAtMs: number,
): SweTurn {
  const startedAtMs = state?.turnStartedAtMs.get(turnDiffKey(threadId, turnId)) ?? null;
  return liveSweTurn(turnId, status, startedAtMs, completedAtMs);
}

function messageInProgress(message: RuntimeMessage): boolean {
  return message.status === 'streaming' || Boolean(message.toolRuns?.some((run) => run.status === 'running' || run.status === 'pending_approval'));
}

function compareRuntimeSweTurnEntries(left: RuntimeSweTurnEntry, right: RuntimeSweTurnEntry): number {
  return compareNullableMs(toEpochMs(left.createdAt), toEpochMs(right.createdAt)) || left.index - right.index;
}

function runtimeMessageToSweItems(message: RuntimeMessage, options: { skipTranscriptContent?: boolean } = {}): SweThreadItem[] {
  if (message.visibility === 'model') return [];
  if (message.role === 'tool') return [];
  const items: SweThreadItem[] = [];
  if (!options.skipTranscriptContent && message.contextCompaction && message.turnId) {
    items.push(contextCompactionItem(contextCompactionItemId(message.turnId)));
  }
  if (message.role === 'system' || message.role === 'developer') {
    if (!options.skipTranscriptContent && message.reviewMode && message.turnId) items.push(reviewModeItem(message.turnId, message.reviewMode));
    return items;
  }
  if (!options.skipTranscriptContent && message.role === 'user' && !message.contextCompaction) {
    items.push({ type: 'userMessage', id: message.id, clientId: message.clientId ?? null, content: [{ type: 'text', text: message.content }] });
  }
  if (!options.skipTranscriptContent && message.role === 'assistant' && !message.contextCompaction && message.content.trim()) {
    if (message.planMode) {
      items.push(planItem(message.id, message.content, message.planMode.status));
    } else {
      items.push(...assistantContentItems(message.id, message.content, message.memoryCitation ?? null));
    }
  }
  for (const run of message.toolRuns ?? []) {
    items.push(runtimeToolRunToSweItem(run));
  }
  return items;
}

function runtimeToolRunToSweItem(run: RuntimeToolRun): SweThreadItem {
  if (FILE_MUTATION_TOOL_NAMES.has(run.name)) {
    return {
      type: 'fileChange',
      id: run.id,
      changes: fileUpdateChangesFromPreview(run.resultPreview ?? run.argumentsPreview),
      status: patchStatusFromToolRun(run.status),
    };
  }
  if (SHELL_TOOL_NAMES.has(run.name)) {
    return commandExecutionItem(
      run.id,
      recordFromJson(run.argumentsPreview),
      commandStatusFromToolRun(run.status),
      run.resultPreview ?? null,
      recordInput(run.data),
      run.durationMs,
      commandSource(run.source),
    );
  }
  const dynamicData = dynamicToolData(run.data);
  return dynamicToolItem(
    run.id,
    run.name,
    recordFromJson(run.argumentsPreview),
    dynamicStatusFromToolRun(run.status),
    dynamicData.success ?? (run.status === 'success' ? true : run.status === 'error' || run.status === 'rejected' || run.status === 'cancelled' ? false : null),
    run.durationMs,
    dynamicData.contentItems,
  );
}

function commandExecutionItem(
  id: string,
  args: Record<string, unknown>,
  status: SweCommandExecutionStatus,
  output: string | null,
  data: Record<string, unknown> = {},
  durationMs?: number,
  source: SweCommandExecutionSource = 'agent',
): SweThreadItem {
  const command = stringField(data.command ?? args.command ?? args.cmd);
  const cwd = stringField(data.directory ?? args.directory ?? args.workdir) || '.';
  return {
    type: 'commandExecution',
    id,
    command,
    cwd,
    processId: stringField(data.process_id) || null,
    source,
    status,
    commandActions: commandActionsForShellCommand(command, cwd),
    aggregatedOutput: output,
    exitCode: numberField(data.exit_code),
    durationMs: durationMs ?? durationFromShellData(data),
  };
}

function dynamicToolItem(
  id: string,
  tool: string,
  args: unknown,
  status: SweDynamicToolCallStatus,
  success: boolean | null,
  durationMs: number | null = null,
  contentItems: RuntimeDynamicToolContentItem[] | null = null,
): SweThreadItem {
  return {
    type: 'dynamicToolCall',
    id,
    namespace: null,
    tool,
    arguments: args,
    status,
    contentItems,
    success,
    durationMs,
  };
}

function dynamicToolData(value: unknown): { contentItems: RuntimeDynamicToolContentItem[] | null; success?: boolean } {
  const input = recordInput(value);
  const contentItems = Array.isArray(input.contentItems)
    ? input.contentItems.filter(isRuntimeDynamicToolContentItem)
    : null;
  return {
    contentItems,
    ...(typeof input.success === 'boolean' ? { success: input.success } : {}),
  };
}

function isRuntimeDynamicToolContentItem(value: unknown): value is RuntimeDynamicToolContentItem {
  const input = recordInput(value);
  if (input.type === 'inputText') return typeof input.text === 'string';
  if (input.type === 'inputImage') return typeof input.imageUrl === 'string' && input.imageUrl.startsWith('data:image/');
  return false;
}

function collabToolCallItemFromMailbox(delivery: RuntimeMailboxDeliveryRecord, status: SweCollabToolCallStatus, receiverThreadId: string): SweThreadItem {
  return {
    type: 'collabToolCall',
    id: `mailbox_${delivery.id}`,
    tool: delivery.triggerTurn || delivery.deliveryMode === 'trigger_turn' ? 'resume_agent' : 'send_input',
    status,
    senderThreadId: delivery.fromThreadId ?? delivery.fromAgentId ?? 'unknown',
    receiverThreadId,
    prompt: delivery.content,
  };
}

function sweItemFromRuntimeStreamItem(item: RuntimeStreamItem): SweThreadItem | null {
  if (item.kind === 'agent_message') return agentMessageItem(item.id, item.content ?? '');
  if (item.kind === 'plan') return planItem(item.id, item.content ?? '');
  if (item.kind === 'reasoning') return reasoningItem(item.id, item.content ? [item.content] : []);
  if (item.kind === 'context_compaction') return contextCompactionItem(item.id);
  if (item.kind === 'collab_tool_call' && item.collabToolCall) {
    return collabToolCallItem(item.id, item.collabToolCall, collabStatusFromStreamItem(item.status));
  }
  if (item.kind === 'tool_call' && item.toolCall) {
    return dynamicToolItem(
      item.id,
      item.toolCall.name,
      recordFromJson(item.toolCall.arguments),
      dynamicStatusFromStreamItem(item.status),
      dynamicSuccessFromStreamItem(item.status),
    );
  }
  return null;
}

function collabToolCallItem(id: string, call: NonNullable<RuntimeStreamItem['collabToolCall']>, status: SweCollabToolCallStatus): SweThreadItem {
  return {
    type: 'collabToolCall',
    id,
    tool: call.tool,
    status,
    senderThreadId: call.senderThreadId,
    ...(call.receiverThreadId ? { receiverThreadId: call.receiverThreadId } : {}),
    ...(call.newThreadId ? { newThreadId: call.newThreadId } : {}),
    ...(call.prompt ? { prompt: call.prompt } : {}),
    ...(call.agentStatus ? { agentStatus: call.agentStatus } : {}),
  };
}

function collabStatusFromStreamItem(status: RuntimeStreamItem['status']): SweCollabToolCallStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'inProgress';
}

function dynamicStatusFromStreamItem(status: RuntimeStreamItem['status']): SweDynamicToolCallStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'inProgress';
}

function dynamicSuccessFromStreamItem(status: RuntimeStreamItem['status']): boolean | null {
  if (status === 'completed') return true;
  if (status === 'failed' || status === 'cancelled') return false;
  return null;
}

function agentMessageItem(id: string, text: string, memoryCitation: RuntimeMessage['memoryCitation'] | null = null): SweThreadItem {
  return { type: 'agentMessage', id, text, phase: null, memoryCitation };
}

function planItem(id: string, text: string, status?: NonNullable<RuntimeMessage['planMode']>['status']): SweThreadItem {
  return { type: 'plan', id, text, ...(status ? { status } : {}) };
}

function reasoningItem(id: string, summary: string[] = [], content: string[] = []): SweThreadItem {
  return { type: 'reasoning', id, summary, content };
}

function contextCompactionItem(id: string): SweThreadItem {
  return { type: 'contextCompaction', id };
}

function reviewModeItem(turnId: string, notice: NonNullable<RuntimeMessage['reviewMode']>): SweThreadItem {
  return {
    type: notice.kind === 'entered' ? 'enteredReviewMode' : 'exitedReviewMode',
    id: turnId,
    review: notice.review,
  };
}

function contextCompactionItemId(turnId: string): string {
  return `${turnId}:context_compaction`;
}

function assistantContentItems(messageId: string, text: string, memoryCitation: RuntimeMessage['memoryCitation'] | null = null): SweThreadItem[] {
  if (!text.trim()) return [];
  const segments = assistantContentSegments(text);
  if (!segments.some((segment) => segment.type === 'think')) return [agentMessageItem(messageId, text, memoryCitation)];

  const items: SweThreadItem[] = [];
  let agentSegmentIndex = 0;
  let reasoningSegmentIndex = 0;
  let citationPending = memoryCitation;
  for (const segment of segments) {
    if (!segment.content.trim()) continue;
    if (segment.type === 'think') {
      items.push(reasoningItem(reasoningItemId(messageId, reasoningSegmentIndex), [segment.content]));
      reasoningSegmentIndex += 1;
      continue;
    }
    items.push(agentMessageItem(agentMessageItemId(messageId, agentSegmentIndex), segment.content, citationPending));
    citationPending = null;
    agentSegmentIndex += 1;
  }
  return items;
}

function completedAssistantContentNotifications(
  threadId: string,
  turnId: string,
  messageId: string,
  text: string,
  completedAtMs: number,
  memoryCitation: RuntimeMessage['memoryCitation'] | null = null,
): SweNotification[] {
  return assistantContentItems(messageId, text, memoryCitation).map((item) => ({
    method: 'item/completed',
    params: { threadId, turnId, item, completedAtMs },
  }));
}

function appendPlanMessageDelta(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
  delta: string,
  startedAtMs: number,
): SweNotification[] {
  const existingPlanItemId = turnPlanItemId(state, threadId, turnId);
  if (existingPlanItemId && existingPlanItemId !== messageId) return [];
  const itemId = existingPlanItemId ?? messageId;
  rememberTurnPlanItem(state, threadId, turnId, itemId);
  const started = ensurePlanItemStarted(state, threadId, turnId, itemId, startedAtMs);
  appendPlanItemText(state, threadId, turnId, itemId, delta);
  return [
    ...started,
    {
      method: 'item/plan/delta',
      params: { threadId, turnId, itemId, delta },
    },
  ];
}

function completedPlanMessageNotifications(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
  content: string,
  planMode: NonNullable<RuntimeMessage['planMode']>,
  completedAtMs: number,
): SweNotification[] {
  const rememberedMessageItem = rememberedPlanMessageItem(state, threadId, messageId);
  const itemId = turnPlanItemId(state, threadId, turnId) ?? rememberedMessageItem?.id ?? messageId;
  const rememberedTurnItem = rememberedStreamItem(state, threadId, turnId, itemId);
  const rememberedText = rememberedTurnItem?.type === 'plan' ? rememberedTurnItem.text : rememberedMessageItem?.text ?? '';
  const item = planItem(itemId, content || rememberedText, planMode.status);
  rememberStreamItem(state, threadId, turnId, item);
  rememberPlanMessageItem(state, threadId, messageId, item);
  return [{
    method: 'item/completed',
    params: { threadId, turnId, item, completedAtMs },
  }];
}

function assistantContentSegments(content: string): AssistantContentSegment[] {
  const segments: AssistantContentSegment[] = [];
  const tagRegex = /<\/?think(?:\s[^>]*)?>|&lt;\/?think(?:\s[^&]*)?&gt;/gi;
  let mode: AssistantStreamMode = 'markdown';
  let segmentStart = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content)) !== null) {
    if (isClosingThinkTag(match[0])) {
      if (mode === 'think') {
        segments.push({ type: 'think', content: content.slice(segmentStart, match.index) });
        mode = 'markdown';
        segmentStart = tagRegex.lastIndex;
      }
      continue;
    }

    if (mode === 'markdown') {
      segments.push({ type: 'markdown', content: content.slice(segmentStart, match.index) });
      mode = 'think';
      segmentStart = tagRegex.lastIndex;
    }
  }

  segments.push({ type: mode, content: content.slice(segmentStart) });
  return segments.filter((segment) => segment.type === 'think' || segment.content.trim());
}

function isClosingThinkTag(tag: string): boolean {
  const normalized = tag.toLowerCase();
  return normalized.startsWith('</') || normalized.startsWith('&lt;/');
}

function agentMessageItemId(messageId: string, segmentIndex: number): string {
  return segmentIndex === 0 ? messageId : `${messageId}:agent:${segmentIndex}`;
}

function reasoningItemId(messageId: string, segmentIndex: number): string {
  return segmentIndex === 0 ? `${messageId}:reasoning` : `${messageId}:reasoning:${segmentIndex}`;
}

function patchStatusFromToolRun(status: RuntimeToolRun['status']): SwePatchApplyStatus {
  if (status === 'success') return 'completed';
  if (status === 'rejected' || status === 'cancelled') return 'declined';
  if (status === 'error') return 'failed';
  return 'inProgress';
}

function commandStatusFromToolRun(status: RuntimeToolRun['status']): SweCommandExecutionStatus {
  if (status === 'success') return 'completed';
  if (status === 'rejected' || status === 'cancelled') return 'declined';
  if (status === 'error') return 'failed';
  return 'inProgress';
}

function dynamicStatusFromToolRun(status: RuntimeToolRun['status']): SweDynamicToolCallStatus {
  if (status === 'success') return 'completed';
  if (status === 'error' || status === 'rejected' || status === 'cancelled') return 'failed';
  return 'inProgress';
}

function commandSource(source: RuntimeToolRun['source']): SweCommandExecutionSource {
  return source === 'userShell' ? 'userShell' : 'agent';
}

function fileUpdateChangesFromPreview(value: string | undefined): SweFileUpdateChange[] {
  const parsed = parseJson(value);
  const diff = isRecord(parsed) && isRecord(parsed.diff) ? parsed.diff : parsed;
  if (!isRecord(diff)) return [];
  const diffs = Array.isArray(diff.diffs) ? diff.diffs : [diff];
  return diffs.map(fileUpdateChangeFromDiff).filter((item): item is SweFileUpdateChange => Boolean(item));
}

function fileUpdateChangeFromDiff(value: unknown): SweFileUpdateChange | null {
  if (!isRecord(value)) return null;
  const path = stringField(value.path);
  if (!path) return null;
  return {
    path,
    kind: patchChangeKind(value.action),
    diff: diffText(value.lines),
  };
}

function patchChangeKind(action: unknown): SwePatchChangeKind {
  const normalized = stringField(action).toLowerCase();
  if (normalized.includes('create') || normalized.includes('add')) return 'add';
  if (normalized.includes('delete') || normalized.includes('remove')) return 'delete';
  return 'update';
}

function diffText(lines: unknown): string {
  if (!Array.isArray(lines)) return '';
  return lines
    .map((line) => {
      if (!isRecord(line)) return '';
      const content = typeof line.content === 'string' ? line.content : '';
      if (line.type === 'added') return `+${content}`;
      if (line.type === 'removed') return `-${content}`;
      if (line.type === 'gap') return '...';
      return ` ${content}`;
    })
    .filter(Boolean)
    .join('\n');
}

function unifiedDiffFromChanges(changes: SweFileUpdateChange[]): string {
  return changes
    .map((change) => {
      const oldPath = change.kind === 'add' ? '/dev/null' : `a/${change.path}`;
      const newPath = change.kind === 'delete' ? '/dev/null' : `b/${change.path}`;
      return [`diff --git a/${change.path} b/${change.path}`, `--- ${oldPath}`, `+++ ${newPath}`, change.diff].filter(Boolean).join('\n');
    })
    .join('\n');
}

function updateTurnDiff(state: SweMapperState | undefined, threadId: string, turnId: string, diff: string): string {
  if (!diff) return state?.turnDiffs.get(turnDiffKey(threadId, turnId)) ?? '';
  if (!state) return diff;
  const key = turnDiffKey(threadId, turnId);
  const previous = state.turnDiffs.get(key);
  const next = previous
    ? previous.includes(diff)
      ? previous
      : `${previous}\n${diff}`
    : diff;
  state.turnDiffs.set(key, next);
  return next;
}

function threadTokenUsage(
  state: SweMapperState | undefined,
  threadId: string,
  usage: RuntimeUsage,
  modelContextWindow?: number,
): SweThreadTokenUsage {
  const last = tokenUsageBreakdown(usage);
  if (!state) {
    return { total: last, last, modelContextWindow: modelContextWindow ?? null };
  }
  const previous = state.tokenUsageTotals.get(threadId) ?? emptyTokenUsageBreakdown();
  const total = addTokenUsageBreakdown(previous, last);
  state.tokenUsageTotals.set(threadId, total);
  return { total, last, modelContextWindow: modelContextWindow ?? null };
}

function tokenUsageBreakdown(usage: RuntimeUsage): SweTokenUsageBreakdown {
  const inputTokens = finiteTokenCount(usage.inputTokens);
  const outputTokens = finiteTokenCount(usage.outputTokens);
  const totalTokens = finiteTokenCount(usage.totalTokens) || inputTokens + outputTokens;
  return {
    totalTokens,
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    reasoningOutputTokens: 0,
  };
}

function addTokenUsageBreakdown(
  left: SweTokenUsageBreakdown,
  right: SweTokenUsageBreakdown,
): SweTokenUsageBreakdown {
  return {
    totalTokens: left.totalTokens + right.totalTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
  };
}

function emptyTokenUsageBreakdown(): SweTokenUsageBreakdown {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function finiteTokenCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function fileChangePatchUpdatedNotification(
  threadId: string,
  turnId: string,
  itemId: string,
  changes: SweFileUpdateChange[],
): SweNotification {
  return {
    method: 'item/fileChange/patchUpdated',
    params: { threadId, turnId, itemId, changes },
  };
}

function shouldEmitItemStarted(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
): boolean {
  if (!state) return true;
  const key = itemKey(threadId, turnId, itemId);
  if (state.startedItems.has(key)) return false;
  state.startedItems.add(key);
  return true;
}

function rememberStreamItem(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  item: SweThreadItem,
): void {
  state?.streamItems.set(itemKey(threadId, turnId, item.id), item);
}

function rememberItemTranscriptMessage(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  item: RuntimeStreamItem,
): void {
  if (!state || !item.transcriptMessageId) return;
  state.itemTranscriptMessageIds.add(itemKey(threadId, turnId, item.transcriptMessageId));
}

function hasItemTranscriptMessage(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
): boolean {
  return state?.itemTranscriptMessageIds.has(itemKey(threadId, turnId, messageId)) === true;
}

function rememberedStreamItem(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
): SweThreadItem | null {
  return state?.streamItems.get(itemKey(threadId, turnId, itemId)) ?? null;
}

function rememberPlanMessage(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
): void {
  state?.planMessageIds.add(itemKey(threadId, turnId, messageId));
}

function isPlanMessage(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
): boolean {
  return state?.planMessageIds.has(itemKey(threadId, turnId, messageId)) === true;
}

function rememberTurnPlanItem(state: SweMapperState | undefined, threadId: string, turnId: string, itemId: string): void {
  state?.turnPlanItemIds.set(turnDiffKey(threadId, turnId), itemId);
}

function turnPlanItemId(state: SweMapperState | undefined, threadId: string, turnId: string): string | null {
  return state?.turnPlanItemIds.get(turnDiffKey(threadId, turnId)) ?? null;
}

function appendPlanItemText(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
  delta: string,
): void {
  if (!state || !delta) return;
  const existing = rememberedStreamItem(state, threadId, turnId, itemId);
  const text = existing?.type === 'plan' ? existing.text : '';
  rememberStreamItem(state, threadId, turnId, planItem(itemId, `${text}${delta}`, existing?.type === 'plan' ? existing.status : undefined));
}

function planMessageKey(threadId: string, messageId: string): string {
  return `${threadId}:${messageId}`;
}

function rememberPlanMessageItem(
  state: SweMapperState | undefined,
  threadId: string,
  messageId: string,
  item: SweThreadItem,
): void {
  if (!state || item.type !== 'plan') return;
  state.planItemsByMessageId.set(planMessageKey(threadId, messageId), item);
}

function rememberedPlanMessageItem(
  state: SweMapperState | undefined,
  threadId: string,
  messageId: string,
): Extract<SweThreadItem, { type: 'plan' }> | null {
  const item = state?.planItemsByMessageId.get(planMessageKey(threadId, messageId));
  return item?.type === 'plan' ? item : null;
}

function streamItemDeltaNotifications(
  threadId: string,
  turnId: string,
  itemId: string,
  item: SweThreadItem | null,
  delta: string,
  startedAtMs: number,
  state: SweMapperState | undefined,
): SweNotification[] {
  if (!delta) return [];
  if (item?.type === 'agentMessage') {
    return [{
      method: 'item/agentMessage/delta',
      params: { threadId, turnId, itemId, delta },
    }];
  }
  if (item?.type === 'plan') {
    appendPlanItemText(state, threadId, turnId, itemId, delta);
    return [{
      method: 'item/plan/delta',
      params: { threadId, turnId, itemId, delta },
    }];
  }
  if (item?.type === 'reasoning') {
    return [{
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId, turnId, itemId, delta, summaryIndex: 0 },
    }];
  }
  return ensureAgentItemStarted(state, threadId, turnId, itemId, startedAtMs).concat({
    method: 'item/agentMessage/delta',
    params: { threadId, turnId, itemId, delta },
  });
}

function ensureAgentItemStarted(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
  startedAtMs: number,
): SweNotification[] {
  const remembered = rememberedStreamItem(state, threadId, turnId, itemId);
  const item = remembered?.type === 'agentMessage' ? remembered : agentMessageItem(itemId, '');
  rememberStreamItem(state, threadId, turnId, item);
  if (!shouldEmitItemStarted(state, threadId, turnId, itemId)) return [];
  return [{
    method: 'item/started',
    params: { threadId, turnId, item, startedAtMs },
  }];
}

function ensurePlanItemStarted(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
  startedAtMs: number,
): SweNotification[] {
  const item = rememberedStreamItem(state, threadId, turnId, itemId) ?? planItem(itemId, '');
  rememberStreamItem(state, threadId, turnId, item);
  if (!shouldEmitItemStarted(state, threadId, turnId, itemId)) return [];
  return [{
    method: 'item/started',
    params: { threadId, turnId, item, startedAtMs },
  }];
}

function ensureReasoningItemStarted(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
  startedAtMs: number,
): SweNotification[] {
  const item = rememberedStreamItem(state, threadId, turnId, itemId) ?? reasoningItem(itemId);
  rememberStreamItem(state, threadId, turnId, item);
  if (!shouldEmitItemStarted(state, threadId, turnId, itemId)) return [];
  return [{
    method: 'item/started',
    params: { threadId, turnId, item, startedAtMs },
  }];
}

function startAssistantMessageStream(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
  text: string,
  startedAtMs: number,
): SweNotification[] {
  if (!text.trim()) return [];
  if (!state) {
    return [{
      method: 'item/started',
      params: { threadId, turnId, item: agentMessageItem(messageId, text), startedAtMs },
    }];
  }
  if (!hasThinkTag(text)) {
    const stream = ensureAssistantMessageStream(state, threadId, turnId, messageId);
    stream.text = text;
    stream.currentAgentItemId = messageId;
    stream.agentSegmentIndex = 1;
    return [{
      method: 'item/started',
      params: { threadId, turnId, item: agentMessageItem(messageId, text), startedAtMs },
    }];
  }
  return appendAssistantMessageDelta(state, threadId, turnId, messageId, text, startedAtMs);
}

function appendAssistantMessageDelta(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
  delta: string,
  startedAtMs: number,
): SweNotification[] {
  if (!delta) return [];
  if (!state) {
    return [
      {
        method: 'item/started',
        params: { threadId, turnId, item: agentMessageItem(messageId, ''), startedAtMs },
      },
      {
        method: 'item/agentMessage/delta',
        params: { threadId, turnId, itemId: messageId, delta },
      },
    ];
  }

  const stream = ensureAssistantMessageStream(state, threadId, turnId, messageId);
  stream.text += delta;
  return streamAssistantDelta(threadId, turnId, messageId, stream, delta, startedAtMs);
}

function streamAssistantDelta(
  threadId: string,
  turnId: string,
  messageId: string,
  stream: AssistantStreamState,
  delta: string,
  startedAtMs: number,
): SweNotification[] {
  const notifications: SweNotification[] = [];
  const tagRegex = /<\/?think(?:\s[^>]*)?>|&lt;\/?think(?:\s[^&]*)?&gt;/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(delta)) !== null) {
    pushAssistantStreamText(notifications, threadId, turnId, messageId, stream, delta.slice(cursor, match.index), startedAtMs);
    if (isClosingThinkTag(match[0])) {
      if (stream.mode === 'think') {
        stream.mode = 'markdown';
        stream.currentReasoningItemId = null;
      }
    } else if (stream.mode === 'markdown') {
      stream.mode = 'think';
      stream.currentAgentItemId = null;
    }
    cursor = tagRegex.lastIndex;
  }

  pushAssistantStreamText(notifications, threadId, turnId, messageId, stream, delta.slice(cursor), startedAtMs);
  return notifications;
}

function pushAssistantStreamText(
  notifications: SweNotification[],
  threadId: string,
  turnId: string,
  messageId: string,
  stream: AssistantStreamState,
  text: string,
  startedAtMs: number,
): void {
  if (!text) return;
  if (stream.mode === 'think') {
    const itemId = ensureReasoningStreamItem(notifications, threadId, turnId, messageId, stream, startedAtMs);
    notifications.push({
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId, turnId, itemId, delta: text, summaryIndex: 0 },
    });
    return;
  }

  const itemId = ensureAgentStreamItem(notifications, threadId, turnId, messageId, stream, startedAtMs);
  notifications.push({
    method: 'item/agentMessage/delta',
    params: { threadId, turnId, itemId, delta: text },
  });
}

function ensureAgentStreamItem(
  notifications: SweNotification[],
  threadId: string,
  turnId: string,
  messageId: string,
  stream: AssistantStreamState,
  startedAtMs: number,
): string {
  if (stream.currentAgentItemId) return stream.currentAgentItemId;
  const itemId = agentMessageItemId(messageId, stream.agentSegmentIndex);
  stream.agentSegmentIndex += 1;
  stream.currentAgentItemId = itemId;
  notifications.push({
    method: 'item/started',
    params: { threadId, turnId, item: agentMessageItem(itemId, ''), startedAtMs },
  });
  return itemId;
}

function ensureReasoningStreamItem(
  notifications: SweNotification[],
  threadId: string,
  turnId: string,
  messageId: string,
  stream: AssistantStreamState,
  startedAtMs: number,
): string {
  if (stream.currentReasoningItemId) return stream.currentReasoningItemId;
  const itemId = reasoningItemId(messageId, stream.reasoningSegmentIndex);
  stream.reasoningSegmentIndex += 1;
  stream.currentReasoningItemId = itemId;
  notifications.push({
    method: 'item/started',
    params: { threadId, turnId, item: reasoningItem(itemId), startedAtMs },
  });
  return itemId;
}

function ensureAssistantMessageStream(
  state: SweMapperState,
  threadId: string,
  turnId: string,
  messageId: string,
): AssistantStreamState {
  const key = itemKey(threadId, turnId, messageId);
  const existing = state.assistantStreams.get(key);
  if (existing) return existing;
  const stream: AssistantStreamState = {
    text: '',
    mode: 'markdown',
    currentAgentItemId: null,
    currentReasoningItemId: null,
    agentSegmentIndex: 0,
    reasoningSegmentIndex: 0,
  };
  state.assistantStreams.set(key, stream);
  return stream;
}

function assistantMessageStream(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
): AssistantStreamState | null {
  return state?.assistantStreams.get(itemKey(threadId, turnId, messageId)) ?? null;
}

function clearAssistantMessageStream(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
): void {
  state?.assistantStreams.delete(itemKey(threadId, turnId, messageId));
}

function clearTurnState(state: SweMapperState | undefined, threadId: string, turnId: string): void {
  if (!state) return;
  const prefix = `${turnDiffKey(threadId, turnId)}:`;
  state.turnDiffs.delete(turnDiffKey(threadId, turnId));
  state.turnStartedAtMs.delete(turnDiffKey(threadId, turnId));
  state.turnPlanItemIds.delete(turnDiffKey(threadId, turnId));
  for (const item of state.startedItems) {
    if (item.startsWith(prefix)) state.startedItems.delete(item);
  }
  for (const item of state.streamItems.keys()) {
    if (item.startsWith(prefix)) state.streamItems.delete(item);
  }
  for (const item of state.itemTranscriptMessageIds) {
    if (item.startsWith(prefix)) state.itemTranscriptMessageIds.delete(item);
  }
  for (const item of state.planMessageIds) {
    if (item.startsWith(prefix)) state.planMessageIds.delete(item);
  }
  for (const item of state.assistantStreams.keys()) {
    if (item.startsWith(prefix)) state.assistantStreams.delete(item);
  }
}

function markTurnRunning(state: SweMapperState | undefined, threadId: string, turnId: string): void {
  if (!state) return;
  threadRuntimeState(state, threadId).runningTurnIds.add(turnId);
}

function markTurnFinished(state: SweMapperState | undefined, threadId: string, turnId: string): void {
  if (!state) return;
  threadRuntimeState(state, threadId).runningTurnIds.delete(turnId);
}

function markApprovalPending(state: SweMapperState | undefined, threadId: string, approvalId: string): void {
  if (!state) return;
  threadRuntimeState(state, threadId).pendingApprovalIds.add(approvalId);
}

function markApprovalResolved(state: SweMapperState | undefined, threadId: string, approvalId: string): void {
  if (!state) return;
  threadRuntimeState(state, threadId).pendingApprovalIds.delete(approvalId);
}

function markSystemError(state: SweMapperState | undefined, threadId: string): void {
  if (!state) return;
  threadRuntimeState(state, threadId).systemError = true;
}

function threadRuntimeState(state: SweMapperState, threadId: string): ThreadRuntimeState {
  const existing = state.threadRuntime.get(threadId);
  if (existing) return existing;
  const runtimeState: ThreadRuntimeState = {
    runningTurnIds: new Set(),
    pendingApprovalIds: new Set(),
    systemError: false,
  };
  state.threadRuntime.set(threadId, runtimeState);
  return runtimeState;
}

function threadStatusChangedNotifications(
  state: SweMapperState | undefined,
  threadId: string,
): SweNotification[] {
  if (!state) return [];
  const status = threadStatusFromRuntime(threadRuntimeState(state, threadId));
  const previous = state.threadStatuses.get(threadId);
  if (previous && sameThreadStatus(previous, status)) return [];
  state.threadStatuses.set(threadId, status);
  return [{
    method: 'thread/status/changed',
    params: { threadId, status },
  }];
}

function threadStatusFromRuntime(runtimeState: ThreadRuntimeState): SweThreadStatus {
  const activeFlags: SweThreadActiveFlag[] = [];
  if (runtimeState.pendingApprovalIds.size > 0) activeFlags.push('waitingOnApproval');
  if (runtimeState.runningTurnIds.size > 0 || activeFlags.length > 0) {
    return { type: 'active', activeFlags };
  }
  return runtimeState.systemError ? { type: 'systemError' } : { type: 'idle' };
}

function sameThreadStatus(left: SweThreadStatus, right: SweThreadStatus): boolean {
  if (left.type !== right.type) return false;
  if (left.type !== 'active' || right.type !== 'active') return true;
  if (left.activeFlags.length !== right.activeFlags.length) return false;
  return left.activeFlags.every((flag, index) => flag === right.activeFlags[index]);
}

function hasThinkTag(text: string): boolean {
  return /<\/?think(?:\s[^>]*)?>|&lt;\/?think(?:\s[^&]*)?&gt;/i.test(text);
}

function itemKey(threadId: string, turnId: string, itemId: string): string {
  return `${turnDiffKey(threadId, turnId)}:${itemId}`;
}

function turnDiffKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

function recordFromJson(value: string | undefined): Record<string, unknown> {
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed : {};
}

function parseJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordInput(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function swePermissionProfile(value: unknown): Record<string, unknown> {
  const permissions = recordInput(value);
  const network = recordInput(permissions.network);
  const fileSystem = recordInput(permissions.file_system ?? permissions.fileSystem);
  const result: Record<string, unknown> = {};
  if (network.enabled === true) result.network = { enabled: true };
  const fileSystemResult = sweFileSystemPermissions(fileSystem);
  if (fileSystemResult) result.fileSystem = fileSystemResult;
  return result;
}

function sweAdditionalPermissionProfile(value: unknown): SweAdditionalPermissionProfile | null {
  const permissions = swePermissionProfile(value);
  return Object.keys(permissions).length ? permissions : null;
}

function sweFileSystemPermissions(fileSystem: Record<string, unknown>): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  const read = stringList(fileSystem.read ?? fileSystem.read_roots ?? fileSystem.readRoots);
  const write = stringList(fileSystem.write ?? fileSystem.writable_roots ?? fileSystem.writableRoots);
  const entries = Array.isArray(fileSystem.entries)
    ? fileSystem.entries.map(sweFileSystemEntry).filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];
  const globScanMaxDepth = numberField(fileSystem.glob_scan_max_depth ?? fileSystem.globScanMaxDepth);
  if (read.length) result.read = read;
  if (write.length) result.write = write;
  if (globScanMaxDepth !== null) result.globScanMaxDepth = globScanMaxDepth;
  if (entries.length) result.entries = entries;
  return Object.keys(result).length ? result : null;
}

function sweFileSystemEntry(value: unknown): Record<string, unknown> | null {
  const entry = recordInput(value);
  const access = stringField(entry.access);
  const pathValue = sweFileSystemPath(entry.path);
  if (!pathValue || !['read', 'write', 'deny'].includes(access)) return null;
  return { path: pathValue, access };
}

function sweFileSystemPath(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') return { type: 'path', path: value };
  const record = recordInput(value);
  const type = stringField(record.type);
  if (!type || type === 'path') {
    const pathValue = stringField(record.path);
    return pathValue ? { type: 'path', path: pathValue } : null;
  }
  if (type === 'glob_pattern' || type === 'globPattern') {
    const pattern = stringField(record.pattern);
    return pattern ? { type: 'globPattern', pattern } : null;
  }
  if (type === 'special') {
    const valueRecord = recordInput(record.value);
    const kind = stringField(valueRecord.kind ?? record.value);
    if (!kind) return null;
    const specialValue: Record<string, unknown> = { kind };
    const subpath = stringField(valueRecord.subpath);
    if (subpath) specialValue.subpath = subpath;
    return { type: 'special', value: specialValue };
  }
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : [];
}

function sweNetworkApprovalContext(context: RuntimeNetworkApprovalContext | undefined): SweNetworkApprovalContext | null {
  if (!context?.host) return null;
  const protocol = sweNetworkApprovalProtocol(context.protocol);
  if (!protocol) return null;
  return { host: context.host, protocol };
}

function sweNetworkApprovalProtocol(protocol: RuntimeNetworkApprovalContext['protocol']): SweNetworkApprovalProtocol | null {
  if (protocol === 'http' || protocol === 'https') return protocol;
  if (protocol === 'socks5-tcp') return 'socks5Tcp';
  if (protocol === 'socks5-udp') return 'socks5Udp';
  return null;
}

function sweCommandExecutionApprovalDecisions(decisions: RuntimeApprovalAvailableDecision[] | undefined): SweCommandExecutionApprovalDecision[] | null {
  if (!decisions?.length) return null;
  const mapped = decisions
    .map(sweCommandExecutionApprovalDecision)
    .filter((decision): decision is SweCommandExecutionApprovalDecision => decision !== null);
  return mapped.length ? mapped : null;
}

function sweCommandExecutionApprovalDecision(decision: RuntimeApprovalAvailableDecision): SweCommandExecutionApprovalDecision | null {
  switch (decision.type) {
    case 'approve':
      return 'accept';
    case 'approve_for_session':
      return 'acceptForSession';
    case 'approve_persistently':
      return 'acceptAndRemember';
    case 'approve_exec_policy_amendment':
      return { acceptWithExecpolicyAmendment: { execpolicy_amendment: decision.proposedExecPolicyAmendment } };
    case 'approve_network_policy_amendment':
      return { applyNetworkPolicyAmendment: { network_policy_amendment: decision.networkPolicyAmendment } };
    case 'reject':
      return 'decline';
    case 'cancel':
      return 'cancel';
    case 'approve_for_turn_with_strict_auto_review':
      return null;
  }
}

function commandActionsForShellCommand(command: string | null | undefined, cwd: string | null | undefined): SweCommandAction[] {
  const text = command?.trim();
  if (!text) return [];
  return splitShellCommandSegments(text).map((segment) => commandActionForShellSegment(segment, cwd || '.'));
}

function commandActionForShellSegment(segment: string, cwd: string): SweCommandAction {
  const words = shellWords(segment);
  const [head, ...tail] = words;
  if (!head) return { type: 'unknown', command: segment };

  if (['ls', 'eza', 'exa', 'tree', 'du'].includes(head)) {
    const pathValue = firstNonFlagOperand(tail, listCommandFlagsWithValues(head));
    return { type: 'listFiles', command: segment, path: pathValue ? shortDisplayPath(pathValue) : null };
  }

  if (['rg', 'rga', 'ripgrep-all'].includes(head)) {
    const candidates = skipFlagValues(trimAtConnector(tail), ['-g', '--glob', '--iglob', '-t', '--type', '--type-add', '--type-not', '-m', '--max-count', '-A', '-B', '-C', '--context', '--max-depth'])
      .filter((item) => !item.startsWith('-'));
    if (tail.includes('--files')) {
      return { type: 'listFiles', command: segment, path: candidates[0] ? shortDisplayPath(candidates[0]) : null };
    }
    return { type: 'search', command: segment, query: candidates[0] ?? null, path: candidates[1] ? shortDisplayPath(candidates[1]) : null };
  }

  if (head === 'git' && tail[0] === 'grep') return grepLikeCommandAction(segment, tail.slice(1));
  if (head === 'git' && tail[0] === 'ls-files') {
    const pathValue = firstNonFlagOperand(tail.slice(1), ['--exclude', '--exclude-from', '--pathspec-from-file']);
    return { type: 'listFiles', command: segment, path: pathValue ? shortDisplayPath(pathValue) : null };
  }

  if (['grep', 'egrep', 'fgrep', 'ag', 'ack', 'pt'].includes(head)) return grepLikeCommandAction(segment, tail);

  if (head === 'find') {
    const pathValue = tail.find((item) => item && !item.startsWith('-') && item !== '(' && item !== ')') ?? null;
    const nameIndex = tail.findIndex((item) => item === '-name' || item === '-iname');
    const query = nameIndex >= 0 ? tail[nameIndex + 1] ?? null : null;
    return query
      ? { type: 'search', command: segment, query, path: pathValue ? shortDisplayPath(pathValue) : null }
      : { type: 'listFiles', command: segment, path: pathValue ? shortDisplayPath(pathValue) : null };
  }

  if (head === 'fd') {
    const operands = skipFlagValues(tail, ['-d', '--max-depth', '-e', '--extension', '-t', '--type']).filter((item) => !item.startsWith('-'));
    return operands[0]
      ? { type: 'search', command: segment, query: operands[0], path: operands[1] ? shortDisplayPath(operands[1]) : null }
      : { type: 'listFiles', command: segment, path: null };
  }

  if (['cat', 'bat', 'batcat', 'less', 'more', 'head', 'tail', 'nl', 'sed', 'awk'].includes(head)) {
    const filePath = readCommandPath(head, tail);
    if (filePath) {
      return {
        type: 'read',
        command: segment,
        name: shortDisplayPath(filePath),
        path: resolveCommandActionPath(filePath, cwd),
      };
    }
  }

  return { type: 'unknown', command: segment };
}

function grepLikeCommandAction(command: string, args: string[]): SweCommandAction {
  const candidates = skipFlagValues(trimAtConnector(args), ['-e', '-f', '-m', '--max-count', '-A', '-B', '-C', '--context', '--exclude', '--exclude-dir', '--include'])
    .filter((item) => !item.startsWith('-'));
  return { type: 'search', command, query: candidates[0] ?? null, path: candidates[1] ? shortDisplayPath(candidates[1]) : null };
}

function readCommandPath(commandName: string, args: string[]): string | null {
  const flagsWithValuesByCommand: Record<string, string[]> = {
    bat: ['--theme', '--language', '--style', '--terminal-width', '--tabs', '--line-range', '--map-syntax'],
    batcat: ['--theme', '--language', '--style', '--terminal-width', '--tabs', '--line-range', '--map-syntax'],
    less: ['-p', '-P', '-x', '-y', '-z', '-j', '--pattern', '--prompt', '--tabs', '--shift', '--jump-target'],
    head: ['-n', '--lines', '-c', '--bytes', '-q', '-v'],
    tail: ['-n', '--lines', '-c', '--bytes', '-q', '-v'],
    nl: ['-s', '-w', '-v', '-i', '-b'],
  };
  const candidates = skipFlagValues(args, flagsWithValuesByCommand[commandName] ?? []).filter((item) => !item.startsWith('-'));
  if (commandName === 'sed' || commandName === 'awk') return candidates.length >= 2 ? candidates[candidates.length - 1] : null;
  return candidates.length === 1 ? candidates[0] : null;
}

function splitShellCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === ';' || char === '\n' || (char === '&' && next === '&') || char === '|') {
      const segment = current.trim();
      if (segment) segments.push(segment);
      current = '';
      if ((char === '&' && next === '&') || (char === '|' && next === '|')) index += 1;
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) segments.push(tail);
  return segments.length ? segments : [command.trim()];
}

function shellWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}

function firstNonFlagOperand(args: string[], flagsWithValues: string[]): string | null {
  return skipFlagValues(args, flagsWithValues).find((item) => !item.startsWith('-')) ?? null;
}

function skipFlagValues(args: string[], flagsWithValues: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item) continue;
    const hasSeparateValue = flagsWithValues.includes(item);
    if (hasSeparateValue) {
      index += 1;
      continue;
    }
    if (flagsWithValues.some((flag) => item.startsWith(`${flag}=`) || (flag.length === 2 && item.startsWith(flag) && item.length > 2))) continue;
    if (item.startsWith('-')) continue;
    values.push(item);
  }
  return values;
}

function trimAtConnector(args: string[]): string[] {
  const index = args.findIndex((item) => ['&&', '||', ';', '|'].includes(item));
  return index >= 0 ? args.slice(0, index) : args;
}

function listCommandFlagsWithValues(commandName: string): string[] {
  if (commandName === 'ls') return ['-I', '-w', '--block-size', '--format', '--time-style', '--color', '--quoting-style'];
  if (commandName === 'tree') return ['-L', '-P', '-I', '--charset', '--filelimit', '--sort'];
  if (commandName === 'du') return ['-d', '--max-depth', '-B', '--block-size', '--exclude', '--time-style'];
  return ['-I', '--ignore-glob', '--color', '--sort', '--time-style', '--time'];
}

function shortDisplayPath(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? value;
}

function resolveCommandActionPath(filePath: string, cwd: string): string {
  if (!filePath || /^(?:[a-zA-Z]:[\\/]|\/|\\\\|[a-zA-Z][a-zA-Z\d+.-]*:)/.test(filePath)) return filePath;
  const base = cwd || '.';
  if (base === '.') return filePath;
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${separator}${filePath}`;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function durationFromShellData(data: Record<string, unknown>): number | null {
  const started = numberField(data.started_at_ms);
  const finished = numberField(data.finished_at_ms);
  return started === null || finished === null ? null : Math.max(0, finished - started);
}

function toEpochMs(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function toEpochSeconds(value: string): number {
  return Math.floor(toEpochMs(value) / 1000);
}

function minPositiveMs(values: number[]): number | null {
  const positive = values.filter((value) => value > 0);
  return positive.length ? Math.min(...positive) : null;
}

function compareNullableMs(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function minEpochSeconds(values: string[]): number | null {
  const times = values.map(toEpochMs).filter((value) => value > 0);
  return times.length ? Math.floor(Math.min(...times) / 1000) : null;
}

function maxEpochSeconds(values: string[]): number | null {
  const times = values.map(toEpochMs).filter((value) => value > 0);
  return times.length ? Math.floor(Math.max(...times) / 1000) : null;
}
