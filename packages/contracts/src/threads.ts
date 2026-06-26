import type { RuntimeToolCall } from './provider.js';

export type RuntimeMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type RuntimeMessage = {
  id: string;
  turnId?: string;
  role: RuntimeMessageRole;
  content: string;
  createdAt: string;
  completedAt?: string;
  status?: 'streaming' | 'complete' | 'error';
  error?: string;
  attachments?: RuntimeMessageAttachment[];
  contextCompaction?: RuntimeContextCompactionNotice;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: RuntimeToolCall[];
  toolRuns?: RuntimeToolRun[];
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

export type RuntimeToolRunStatus = 'pending_approval' | 'running' | 'success' | 'error' | 'rejected';

export type RuntimeToolRun = {
  id: string;
  name: string;
  status: RuntimeToolRunStatus;
  argumentsPreview?: string;
  resultPreview?: string;
  startedAt?: string;
  completedAt?: string;
  approvalId?: string;
  approvalReason?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  approvalMessage?: string;
};

export type RuntimeThreadSummary = {
  id: string;
  projectId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  messageCount: number;
  lastMessagePreview: string;
};

export type RuntimeThread = RuntimeThreadSummary & {
  contextCompaction?: RuntimeThreadContextCompactionState;
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
};

export type ThreadPatch = {
  title?: string;
  archived?: boolean;
};

export type SendTurnInput = {
  input: string;
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
