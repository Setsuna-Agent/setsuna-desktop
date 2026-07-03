export type RuntimeMemoryScope = 'global' | 'project';
export type RuntimeMemoryOrigin = 'active' | 'passive';
export type RuntimeMemoryKind = 'preference' | 'project_rule' | 'fact' | 'workflow' | 'decision' | 'note';
export type RuntimeMemoryStage1Status = 'succeeded' | 'succeeded_no_output' | 'failed';
export type RuntimeMemoryPhase2WorkspaceChangeStatus = 'A' | 'M' | 'D';
export type RuntimeMemoryPhase2JobClaimStatus = 'claimed' | 'skipped_running' | 'skipped_cooldown' | 'skipped_no_input';

export type RuntimeMemoryCitationEntry = {
  path: string;
  lineStart: number;
  lineEnd: number;
  note: string;
};

export type RuntimeMemoryCitation = {
  entries: RuntimeMemoryCitationEntry[];
  rolloutIds: string[];
};

export type RuntimeMemorySourceLocation = {
  path: string;
  lineStart: number;
  lineEnd: number;
  note: string;
};

export type RuntimeMemoryRecord = {
  id: string;
  scope: RuntimeMemoryScope;
  projectId?: string;
  content: string;
  kind?: RuntimeMemoryKind;
  origin?: RuntimeMemoryOrigin;
  source?: string;
  sourceThreadId?: string;
  sourceTurnId?: string;
  title?: string;
  tags?: string[];
  workspaceRoot?: string;
  sourceLocation?: RuntimeMemorySourceLocation;
  usageCount?: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeMemoryStage1Output = {
  id: string;
  threadId: string;
  turnId?: string;
  status: RuntimeMemoryStage1Status;
  sourceUpdatedAt: string;
  rawMemory: string;
  rolloutSummary: string;
  rolloutSlug?: string;
  rolloutPath?: string;
  cwd?: string;
  projectId?: string;
  failureReason?: string;
  usageCount?: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeMemoryQuery = {
  scope?: RuntimeMemoryScope;
  projectId?: string;
  search?: string;
  limit?: number;
};

export type CreateRuntimeMemoryInput = {
  scope?: RuntimeMemoryScope;
  projectId?: string;
  content: string;
  kind?: RuntimeMemoryKind;
  origin?: RuntimeMemoryOrigin;
  source?: string;
  sourceThreadId?: string;
  sourceTurnId?: string;
  title?: string;
  tags?: string[];
  workspaceRoot?: string;
};

export type CreateRuntimeMemoryStage1OutputInput = {
  threadId: string;
  turnId?: string;
  status?: RuntimeMemoryStage1Status;
  sourceUpdatedAt?: string;
  rawMemory?: string;
  rolloutSummary?: string;
  rolloutSlug?: string;
  rolloutPath?: string;
  cwd?: string;
  projectId?: string;
  failureReason?: string;
};

export type RuntimeMemoryStage1OutputList = {
  outputs: RuntimeMemoryStage1Output[];
};

export type RuntimeMemoryPhase2WorkspaceChange = {
  status: RuntimeMemoryPhase2WorkspaceChangeStatus;
  path: string;
};

export type RuntimeMemoryPhase2Workspace = {
  root: string;
  hasChanges: boolean;
  changes: RuntimeMemoryPhase2WorkspaceChange[];
  diffPath?: string;
};

export type RuntimeMemoryPhase2JobClaim = {
  status: RuntimeMemoryPhase2JobClaimStatus;
  ownershipToken?: string;
  inputWatermark?: number;
};

export type RuntimeMemoryList = {
  memories: RuntimeMemoryRecord[];
};

export type RuntimeMemoryUsageUpdate = {
  updated: number;
  rolloutIds: string[];
};

export type RuntimeMemoryFileEntry = {
  path: string;
  entryType: 'file' | 'directory';
};

export type RuntimeMemoryFileList = {
  path?: string;
  entries: RuntimeMemoryFileEntry[];
  nextCursor?: string | null;
  truncated: boolean;
};

export type RuntimeMemoryFileReadInput = {
  path: string;
  lineOffset?: number;
  maxLines?: number;
};

export type RuntimeMemoryFileRead = {
  path: string;
  content: string;
  startLineNumber: number;
  truncated: boolean;
};

export type RuntimeMemorySearchMatchMode = 'any' | 'all_on_same_line' | { type: 'all_within_lines'; lineCount: number };

export type RuntimeMemoryFileSearchInput = {
  queries: string[];
  matchMode?: RuntimeMemorySearchMatchMode;
  path?: string;
  cursor?: string;
  contextLines?: number;
  caseSensitive?: boolean;
  maxResults?: number;
};

export type RuntimeMemoryFileSearchMatch = {
  path: string;
  matchLineNumber: number;
  contentStartLineNumber: number;
  content: string;
  matchedQueries: string[];
};

export type RuntimeMemoryFileSearch = {
  queries: string[];
  matchMode: RuntimeMemorySearchMatchMode;
  path?: string;
  matches: RuntimeMemoryFileSearchMatch[];
  nextCursor?: string | null;
  truncated: boolean;
};

export type RuntimeMemoryPreviewItem = {
  id: string;
  title: string;
  scope: RuntimeMemoryScope;
  origin: RuntimeMemoryOrigin;
  kind?: RuntimeMemoryKind;
  source?: string;
  projectId?: string;
  workspaceRoot?: string;
  storageRoot?: string;
  createdAt?: string;
  updatedAt: string;
  chars: number;
  preview: string;
  tags?: string[];
};

export type RuntimeMemoryPreview = {
  storagePath: string;
  total: number;
  items: RuntimeMemoryPreviewItem[];
};
