import type { RuntimeEvent } from './events.js';
import type { RuntimeGitInfo, RuntimeMessage, RuntimeThread, RuntimeThreadGoal, RuntimeToolRun } from './threads.js';
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
export type SweThreadActiveFlag = 'waitingOnApproval' | 'waitingOnUserInput';
export type SweThreadStatus =
  | { type: 'notLoaded' | 'idle' | 'systemError' }
  | { type: 'active'; activeFlags: SweThreadActiveFlag[] };

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
      contentItems: null;
      success: boolean | null;
      durationMs: number | null;
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

export type SweTurn = {
  id: string;
  items: SweThreadItem[];
  itemsView: 'notLoaded' | 'summary' | 'full';
  status: 'inProgress' | 'completed' | 'failed' | 'interrupted';
  error: null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
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
  turnDiffs: Map<string, string>;
  turnStartedAtMs: Map<string, number>;
  startedItems: Set<string>;
  threadStatuses: Map<string, SweThreadStatus>;
  threadRuntime: Map<string, ThreadRuntimeState>;
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

export function createSweNotificationMapper(): (event: RuntimeEvent) => SweNotification[] {
  const state: SweMapperState = {
    assistantStreams: new Map(),
    turnDiffs: new Map(),
    turnStartedAtMs: new Map(),
    startedItems: new Set(),
    threadStatuses: new Map(),
    threadRuntime: new Map(),
  };
  return (event) => runtimeEventToSweNotifications(event, state);
}

export function runtimeEventsToSweNotifications(events: RuntimeEvent[]): SweNotification[] {
  const mapEvent = createSweNotificationMapper();
  return events.flatMap((event) => mapEvent(event));
}

export function runtimeThreadToSweTurns(thread: RuntimeThread): SweTurn[] {
  const groups = new Map<string, Array<{ index: number; message: RuntimeMessage }>>();
  for (const [index, message] of thread.messages.entries()) {
    if (message.visibility === 'model') continue;
    if (!message.turnId) continue;
    groups.set(message.turnId, [...(groups.get(message.turnId) ?? []), { index, message }]);
  }
  return [...groups.entries()]
    .map(([turnId, entries]) => ({
      firstIndex: Math.min(...entries.map((entry) => entry.index)),
      messages: [...entries].sort(compareRuntimeMessageEntries).map((entry) => entry.message),
      startedAtMs: minPositiveMs(entries.map((entry) => toEpochMs(entry.message.createdAt))),
      turnId,
    }))
    .sort((left, right) => compareNullableMs(left.startedAtMs, right.startedAtMs) || left.firstIndex - right.firstIndex)
    .map(({ turnId, messages }) => runtimeMessagesToSweTurn(turnId, messages));
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

  if (event.type === 'message.created') {
    const message = event.payload.message;
    if (!turnId || message.role === 'tool') return [];
    if (message.role === 'system') {
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
    if (message.status === 'streaming') {
      return startAssistantMessageStream(state, event.threadId, turnId, message.id, message.content, toEpochMs(event.createdAt));
    }
    return completedAssistantContentNotifications(event.threadId, turnId, message.id, message.content, toEpochMs(event.createdAt), message.memoryCitation ?? null);
  }

  if (event.type === 'message.delta') {
    if (!turnId) return [];
    return appendAssistantMessageDelta(state, event.threadId, turnId, event.payload.messageId, event.payload.text, toEpochMs(event.createdAt));
  }

  if (event.type === 'message.completed') {
    if (!turnId) return [];
    const stream = assistantMessageStream(state, event.threadId, turnId, event.payload.messageId);
    if (!stream) return [];
    clearAssistantMessageStream(state, event.threadId, turnId, event.payload.messageId);
    return completedAssistantContentNotifications(event.threadId, turnId, event.payload.messageId, stream.text, toEpochMs(event.createdAt), event.payload.memoryCitation ?? null);
  }

  if (event.type === 'tool.started') {
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
  return dynamicToolItem(id, toolName, recordFromJson(payload.argumentsPreview), status === 'success' ? 'completed' : 'failed', status === 'success');
}

function runtimeMessagesToSweTurn(turnId: string, messages: RuntimeMessage[]): SweTurn {
  const items = messages.flatMap(runtimeMessageToSweItems);
  const startedAt = minEpochSeconds(messages.map((message) => message.createdAt));
  const hasError = messages.some((message) => message.status === 'error');
  const inProgress = messages.some(messageInProgress);
  const completedAt = inProgress ? null : maxEpochSeconds(messages.map((message) => message.completedAt ?? message.createdAt));
  return {
    id: turnId,
    items,
    itemsView: 'full',
    status: hasError ? 'failed' : inProgress ? 'inProgress' : 'completed',
    error: null,
    startedAt,
    completedAt,
    durationMs: startedAt === null || completedAt === null ? null : Math.max(0, (completedAt - startedAt) * 1000),
  };
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

function compareRuntimeMessageEntries(
  left: { index: number; message: RuntimeMessage },
  right: { index: number; message: RuntimeMessage },
): number {
  return compareNullableMs(toEpochMs(left.message.createdAt), toEpochMs(right.message.createdAt)) || left.index - right.index;
}

function runtimeMessageToSweItems(message: RuntimeMessage): SweThreadItem[] {
  if (message.visibility === 'model') return [];
  if (message.role === 'tool') return [];
  if (message.role === 'system') {
    const items: SweThreadItem[] = [];
    if (message.reviewMode && message.turnId) items.push(reviewModeItem(message.turnId, message.reviewMode));
    if (message.contextCompaction && message.turnId) items.push(contextCompactionItem(contextCompactionItemId(message.turnId)));
    return items;
  }
  const items: SweThreadItem[] = [];
  if (message.role === 'user') {
    items.push({ type: 'userMessage', id: message.id, clientId: message.clientId ?? null, content: [{ type: 'text', text: message.content }] });
  }
  if (message.role === 'assistant' && message.content.trim()) {
    items.push(...assistantContentItems(message.id, message.content, message.memoryCitation ?? null));
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
  return dynamicToolItem(
    run.id,
    run.name,
    recordFromJson(run.argumentsPreview),
    dynamicStatusFromToolRun(run.status),
    run.status === 'success' ? true : run.status === 'error' || run.status === 'rejected' ? false : null,
    run.durationMs,
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
): SweThreadItem {
  return {
    type: 'dynamicToolCall',
    id,
    namespace: null,
    tool,
    arguments: args,
    status,
    contentItems: null,
    success,
    durationMs,
  };
}

function agentMessageItem(id: string, text: string, memoryCitation: RuntimeMessage['memoryCitation'] | null = null): SweThreadItem {
  return { type: 'agentMessage', id, text, phase: null, memoryCitation };
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
  if (status === 'rejected') return 'declined';
  if (status === 'error') return 'failed';
  return 'inProgress';
}

function commandStatusFromToolRun(status: RuntimeToolRun['status']): SweCommandExecutionStatus {
  if (status === 'success') return 'completed';
  if (status === 'rejected') return 'declined';
  if (status === 'error') return 'failed';
  return 'inProgress';
}

function dynamicStatusFromToolRun(status: RuntimeToolRun['status']): SweDynamicToolCallStatus {
  if (status === 'success') return 'completed';
  if (status === 'error' || status === 'rejected') return 'failed';
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
  const next = previous ? `${previous}\n${diff}` : diff;
  state.turnDiffs.set(key, next);
  return next;
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
  for (const item of state.startedItems) {
    if (item.startsWith(prefix)) state.startedItems.delete(item);
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
