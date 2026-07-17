import type { RuntimeModelRequestStepSnapshot, RuntimeModelVerification, RuntimeSafetyBuffering, RuntimeStreamItem, RuntimeToolCall } from './provider.js';
import type { RuntimeMemoryCitation } from './memory.js';
import type { RuntimeHookSource } from './config.js';
import type { RuntimeUsage } from './usage.js';
import type { RuntimeApprovalAvailableDecision, RuntimeExecPolicyAmendment, RuntimeMcpElicitation, RuntimeNetworkApprovalContext, RuntimeNetworkPolicyAmendment, RuntimePermissionApprovalContext, RuntimeUserInputRequest } from './approvals.js';
import type { RuntimeMessageAttachment } from './attachments.js';
import type { RuntimePluginReference } from './plugins.js';

export type RuntimeMessageRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';
export type RuntimeMessagePromptSource = 'hook' | 'plan' | 'review' | 'goal' | 'runtime_context';

export type RuntimeMessage = {
  id: string;
  clientId?: string;
  turnId?: string;
  role: RuntimeMessageRole;
  promptSource?: RuntimeMessagePromptSource;
  content: string;
  createdAt: string;
  completedAt?: string;
  status?: 'streaming' | 'complete' | 'error';
  visibility?: 'transcript' | 'model';
  error?: string;
  attachments?: RuntimeMessageAttachment[];
  contextCompaction?: RuntimeContextCompactionNotice;
  reviewMode?: RuntimeReviewModeNotice;
  planMode?: RuntimePlanModeNotice;
  memoryCitation?: RuntimeMemoryCitation;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: RuntimeToolCall[];
  toolRuns?: RuntimeToolRun[];
  hookRuns?: RuntimeHookRun[];
};

export type RuntimeContextCompactionNotice = {
  autoCompactTokenLimit?: number;
  compactedMessageCount: number;
  compactedRequestTokens?: number;
  compactedTokens: number;
  forced?: boolean;
  historyTokens?: number;
  keptRecentMessageCount: number;
  maxContextTokens?: number;
  maxContextTokensK: number;
  message?: string;
  originalMessageCount: number;
  originalRequestTokens?: number;
  originalTokens: number;
  scope?: string;
  source?: 'local' | 'remote';
  summaryRole?: string;
  summaryTokens?: number;
  targetContextTokens?: number;
  tokensUntilCompaction?: number;
  transcriptAfterMessageId?: string;
  triggerScopes?: string[];
};

export type RuntimeReviewModeNotice = {
  kind: 'entered' | 'exited';
  review: string;
};

export type RuntimePlanModeNotice = {
  mode: 'plan';
  status: 'awaiting_confirmation' | 'accepted' | 'dismissed';
};

export type RuntimePlanDecision = Exclude<RuntimePlanModeNotice['status'], 'awaiting_confirmation'>;

export type RuntimeMailboxDeliveryRecord = {
  id: string;
  content: string;
  createdAt: string;
  turnId?: string;
  deliveryMode?: 'queue_only' | 'trigger_turn';
  fromAgentId?: string;
  fromThreadId?: string;
  toAgentId?: string;
  triggerTurn?: boolean;
};

export type RuntimeThreadTurnTaskKind = 'regular' | 'compact' | 'review' | 'goal' | 'user_shell';

export type RuntimeThreadTurnStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

export type RuntimeThreadTurnTokenCount = {
  createdAt: string;
  modelContextWindow?: number;
  tokensUntilCompaction?: number;
  usage: RuntimeUsage;
};

export type RuntimeThreadTurnStepSnapshot = {
  createdAt: string;
  snapshot: RuntimeModelRequestStepSnapshot;
};

export type RuntimeThreadTurn = {
  id: string;
  completedAt?: string;
  diff?: string;
  error?: string;
  input?: string;
  items: RuntimeStreamItem[];
  modelVerifications?: RuntimeModelVerification[];
  safetyBuffering?: RuntimeSafetyBuffering;
  startedAt?: string;
  status?: RuntimeThreadTurnStatus;
  stepSnapshots?: RuntimeThreadTurnStepSnapshot[];
  taskKind?: RuntimeThreadTurnTaskKind;
  tokenCounts?: RuntimeThreadTurnTokenCount[];
};

export type RuntimeThreadContextCompactionState = {
  status: 'running' | 'completed';
  turnId?: string;
  completedAt?: string;
  forced?: boolean;
  maxContextTokens?: number;
  maxContextTokensK?: number;
  notice?: RuntimeContextCompactionNotice;
  percent?: number;
  startedAt?: string;
  tokensUntilCompaction?: number;
  usedTokens?: number;
};

export type RuntimeThreadGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';

export type RuntimeThreadGoal = {
  threadId: string;
  objective: string;
  status: RuntimeThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export type RuntimeThreadGoalPatch = {
  objective?: string;
  status?: RuntimeThreadGoalStatus;
  tokenBudget?: number | null;
};

export type RuntimeGitInfo = {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
};

export type RuntimeThreadMemoryMode = 'enabled' | 'disabled' | 'polluted';

export type RuntimeToolRunStatus = 'pending_approval' | 'running' | 'success' | 'error' | 'rejected' | 'cancelled';

export type RuntimeToolRunPhase = 'preparing' | 'executing';

export type RuntimeHookRunEventName = 'PreToolUse' | 'PermissionRequest' | 'PostToolUse' | 'PreCompact' | 'PostCompact' | 'SessionStart' | 'SubagentStart' | 'UserPromptSubmit' | 'SubagentStop' | 'Stop';

export type RuntimeHookRunStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'stopped';

export type RuntimeHookOutputEntryKind = 'warning' | 'stop' | 'feedback' | 'context' | 'error';

export type RuntimeHookOutputEntry = {
  kind: RuntimeHookOutputEntryKind;
  text: string;
};

export type RuntimeHookRun = {
  id: string;
  turnId?: string;
  toolCallId?: string;
  toolName?: string;
  eventName: RuntimeHookRunEventName;
  handlerType: 'command';
  status: RuntimeHookRunStatus;
  command?: string;
  matcher?: string | null;
  lastAssistantMessagePreview?: string;
  promptPreview?: string;
  statusMessage?: string | null;
  sourcePath?: string;
  source?: RuntimeHookSource;
  pluginId?: string;
  message?: string;
  entries?: RuntimeHookOutputEntry[];
  stdoutPreview?: string;
  stderrPreview?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
};

export type RuntimeToolRun = {
  id: string;
  name: string;
  plugin?: RuntimePluginReference;
  source?: 'agent' | 'userShell';
  status: RuntimeToolRunStatus;
  phase?: RuntimeToolRunPhase;
  argumentsPreview?: string;
  argumentsLength?: number;
  resultPreview?: string;
  data?: unknown;
  durationMs?: number;
  preparedAt?: string;
  startedAt?: string;
  completedAt?: string;
  approvalId?: string;
  approvalReason?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approvalMessage?: string;
  availableApprovalDecisions?: RuntimeApprovalAvailableDecision[];
  proposedExecPolicyAmendment?: RuntimeExecPolicyAmendment;
  networkApprovalContext?: RuntimeNetworkApprovalContext;
  proposedNetworkPolicyAmendments?: RuntimeNetworkPolicyAmendment[];
  permissionApprovalContext?: RuntimePermissionApprovalContext;
  elicitation?: RuntimeMcpElicitation;
  userInput?: RuntimeUserInputRequest;
  hookRuns?: RuntimeHookRun[];
};

export type RuntimeThreadSummary = {
  id: string;
  activeTurnId?: string | null;
  forkedFromId?: string;
  parentThreadId?: string;
  projectId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  memoryMode?: RuntimeThreadMemoryMode;
  gitInfo?: RuntimeGitInfo | null;
  goal?: RuntimeThreadGoal;
  messageCount: number;
  lastMessagePreview: string;
};

export type RuntimeThread = RuntimeThreadSummary & {
  activeTurnId?: string | null;
  contextCompaction?: RuntimeThreadContextCompactionState;
  mailboxDeliveries?: RuntimeMailboxDeliveryRecord[];
  pendingHookRuns?: RuntimeHookRun[];
  turns?: RuntimeThreadTurn[];
  messages: RuntimeMessage[];
  lastSeq: number;
};

export type ThreadQuery = {
  search?: string;
  includeArchived?: boolean;
  ancestorThreadId?: string;
  parentThreadId?: string;
  scope?: 'all' | 'global' | 'project';
  projectId?: string;
};

export type ThreadList = {
  threads: RuntimeThreadSummary[];
};

export type CreateThreadInput = {
  title?: string;
  projectId?: string;
  forkedFromId?: string;
  parentThreadId?: string;
  memoryMode?: RuntimeThreadMemoryMode;
};

export type ThreadPatch = {
  title?: string;
  archived?: boolean;
};

export type ThreadMemoryModePatch = {
  mode: RuntimeThreadMemoryMode;
};

export type RuntimeCollaborationMode = 'default' | 'plan';

export type SendTurnInput = {
  input: string;
  clientId?: string;
  attachments?: RuntimeMessageAttachment[];
  collaborationMode?: RuntimeCollaborationMode;
  planDecision?: RuntimePlanDecision;
  skillIds?: string[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export type SteerTurnInput = {
  input: string;
  expectedTurnId: string;
  clientId?: string;
  attachments?: RuntimeMessageAttachment[];
  skillIds?: string[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export type SendTurnResponse = {
  accepted: true;
  turnId: string;
};

export type MessagePatch = {
  content: string;
};

export type MessageDeleteInput = {
  messageIds: string[];
};

export type RegenerateMessageInput = {
  content?: string;
  skillIds?: string[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export type RuntimeReviewTarget = { type: 'uncommittedChanges' } | { type: 'baseBranch'; branch: string } | { type: 'commit'; sha: string; title?: string } | { type: 'custom'; instructions: string };
