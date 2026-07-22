import type {
  RuntimeExecPolicyAmendment,
  RuntimeNetworkPolicyAmendment
} from '../approvals.js';
import type {
  RuntimeDynamicToolContentItem,
  RuntimeModelRequestStepSnapshot,
  RuntimeModelVerification,
  RuntimeSafetyBuffering,
} from '../provider.js';
import type { RuntimeGitInfo, RuntimeMessage, RuntimeThreadGoal } from '../threads.js';
import type { RuntimeUsage } from '../usage.js';

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
