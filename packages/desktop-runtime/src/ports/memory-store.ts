import type {
  CreateRuntimeMemoryInput,
  CreateRuntimeMemoryStage1OutputInput,
  RuntimeMemoryCitation,
  RuntimeMemoryFileList,
  RuntimeMemoryFileRead,
  RuntimeMemoryFileReadInput,
  RuntimeMemoryFileSearch,
  RuntimeMemoryFileSearchInput,
  RuntimeMemoryList,
  RuntimeMemoryPhase2JobClaim,
  RuntimeMemoryPhase2Workspace,
  RuntimeMemoryPreview,
  RuntimeMemoryQuery,
  RuntimeMemoryRecord,
  RuntimeMemoryStage1Output,
  RuntimeMemoryStage1OutputList,
  RuntimeMemoryUsageUpdate,
} from '@setsuna-desktop/contracts';

export type MemoryStore = {
  listMemories(query?: RuntimeMemoryQuery): Promise<RuntimeMemoryList>;
  listMemoryFiles(query?: { path?: string; cursor?: string; maxResults?: number }): Promise<RuntimeMemoryFileList>;
  readMemoryFile(input: RuntimeMemoryFileReadInput): Promise<RuntimeMemoryFileRead>;
  searchMemoryFiles(input: RuntimeMemoryFileSearchInput): Promise<RuntimeMemoryFileSearch>;
  recordMemoryCitationUsage(citation: RuntimeMemoryCitation): Promise<RuntimeMemoryUsageUpdate>;
  listStage1Outputs(): Promise<RuntimeMemoryStage1OutputList>;
  recordStage1Output(input: CreateRuntimeMemoryStage1OutputInput): Promise<RuntimeMemoryStage1Output>;
  claimPhase2Job(input: { ownerId: string; leaseSeconds: number; retryDelaySeconds: number }): Promise<RuntimeMemoryPhase2JobClaim>;
  heartbeatPhase2Job(input: { ownershipToken: string; leaseSeconds: number }): Promise<boolean>;
  markPhase2JobSucceeded(input: { ownershipToken: string; completionWatermark: number }): Promise<boolean>;
  markPhase2JobFailed(input: { ownershipToken: string; reason: string; retryDelaySeconds: number }): Promise<boolean>;
  preparePhase2Workspace(): Promise<RuntimeMemoryPhase2Workspace>;
  syncPhase2Workspace(): Promise<RuntimeMemoryPhase2Workspace>;
  resetPhase2WorkspaceBaseline(): Promise<RuntimeMemoryPhase2Workspace>;
  previewMemories(): Promise<RuntimeMemoryPreview>;
  rememberMemory(input: CreateRuntimeMemoryInput): Promise<RuntimeMemoryRecord>;
  deleteMemory(memoryId: string): Promise<void>;
  clearMemories(): Promise<void>;
};
