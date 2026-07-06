import type { RuntimeToolCall } from './provider.js';
import type { RuntimeMemoryCitation } from './memory.js';
import type { RuntimeHookSource } from './config.js';
import type {
  RuntimeApprovalAvailableDecision,
  RuntimeExecPolicyAmendment,
  RuntimeNetworkApprovalContext,
  RuntimeNetworkPolicyAmendment,
  RuntimePermissionApprovalContext,
} from './approvals.js';

export type RuntimeMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type RuntimeMessage = {
  id: string;
  clientId?: string;
  turnId?: string;
  role: RuntimeMessageRole;
  content: string;
  createdAt: string;
  completedAt?: string;
  status?: 'streaming' | 'complete' | 'error';
  visibility?: 'transcript' | 'model';
  error?: string;
  attachments?: RuntimeMessageAttachment[];
  contextCompaction?: RuntimeContextCompactionNotice;
  reviewMode?: RuntimeReviewModeNotice;
  memoryCitation?: RuntimeMemoryCitation;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: RuntimeToolCall[];
  toolRuns?: RuntimeToolRun[];
  hookRuns?: RuntimeHookRun[];
};

export type RuntimeMessageAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
};

export type RuntimeContextCompactionNotice = {
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
  summaryRole?: string;
  summaryTokens?: number;
  targetContextTokens?: number;
  triggerScopes?: string[];
};

export type RuntimeReviewModeNotice = {
  kind: 'entered' | 'exited';
  review: string;
};

export type RuntimeThreadContextCompactionState = {
  status: 'running' | 'completed';
  completedAt?: string;
  forced?: boolean;
  maxContextTokens?: number;
  maxContextTokensK?: number;
  notice?: RuntimeContextCompactionNotice;
  percent?: number;
  startedAt?: string;
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

export type RuntimeGitInfo = {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
};

export type RuntimeThreadMemoryMode = 'enabled' | 'disabled' | 'polluted';

export type RuntimeToolRunStatus = 'pending_approval' | 'running' | 'success' | 'error' | 'rejected';

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
  source?: 'agent' | 'userShell';
  status: RuntimeToolRunStatus;
  argumentsPreview?: string;
  resultPreview?: string;
  data?: unknown;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  approvalId?: string;
  approvalReason?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  approvalMessage?: string;
  availableApprovalDecisions?: RuntimeApprovalAvailableDecision[];
  proposedExecPolicyAmendment?: RuntimeExecPolicyAmendment;
  networkApprovalContext?: RuntimeNetworkApprovalContext;
  proposedNetworkPolicyAmendments?: RuntimeNetworkPolicyAmendment[];
  permissionApprovalContext?: RuntimePermissionApprovalContext;
  hookRuns?: RuntimeHookRun[];
};

export type RuntimeThreadSummary = {
  id: string;
  activeTurnId?: string | null;
  forkedFromId?: string;
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
  contextCompaction?: RuntimeThreadContextCompactionState;
  pendingHookRuns?: RuntimeHookRun[];
  messages: RuntimeMessage[];
  lastSeq: number;
};

export type ThreadQuery = {
  search?: string;
  includeArchived?: boolean;
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
  memoryMode?: RuntimeThreadMemoryMode;
};

export type ThreadPatch = {
  title?: string;
  archived?: boolean;
};

export type ThreadMemoryModePatch = {
  mode: RuntimeThreadMemoryMode;
};

export type SendTurnInput = {
  input: string;
  clientId?: string;
  attachments?: RuntimeMessageAttachment[];
  skillIds?: string[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export type SteerTurnInput = {
  input: string;
  expectedTurnId: string;
  clientId?: string;
  attachments?: RuntimeMessageAttachment[];
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
