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

export type RuntimeThreadContextCompactionState = {
  status: 'running' | 'completed';
  /** Sequence of the compaction event that supplied this budget. */
  seq?: number;
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
