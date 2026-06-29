import type { AnswerRuntimeApprovalInput, RuntimeApprovalList } from './approvals.js';
import type { RuntimeAvailableModelsResponse, RuntimeConfigInput, RuntimeConfigState, RuntimeFetchModelsInput } from './config.js';
import type { RuntimeEvent } from './events.js';
import type { CreateRuntimeMemoryInput, RuntimeMemoryList, RuntimeMemoryPreview, RuntimeMemoryQuery } from './memory.js';
import type { RuntimeMcpServerInput, RuntimeMcpServerList, RuntimeMcpServerPatch, RuntimeMcpToolList } from './mcp.js';
import type { RuntimeSkillDetail, RuntimeSkillInput, RuntimeSkillList, RuntimeSkillPatch } from './skills.js';
import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RegenerateMessageInput,
  RuntimeThread,
  SendTurnInput,
  SendTurnResponse,
  ThreadList,
  ThreadPatch,
  ThreadQuery,
} from './threads.js';
import type { RuntimeUsageQuery, RuntimeUsageResponse } from './usage.js';
import type {
  AddWorkspaceProjectInput,
  WorkspaceEntrySearchResponse,
  WorkspaceEntryList,
  WorkspaceFileRead,
  WorkspaceProject,
  WorkspaceProjectList,
  WorkspaceSearchResponse,
  WorkspaceStatus,
} from './workspace.js';

export type RuntimeHealth = {
  ok: true;
  service: 'setsuna-desktop-runtime';
  startedAt: string;
  version: string;
};

export type RuntimeRequestInput = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
};

export type DesktopRuntimeClient = {
  request<T = unknown>(input: RuntimeRequestInput): Promise<T>;
  listThreads(query?: ThreadQuery): Promise<ThreadList>;
  getThread(threadId: string): Promise<RuntimeThread>;
  createThread(input?: CreateThreadInput): Promise<RuntimeThread>;
  updateThread(threadId: string, patch: ThreadPatch): Promise<RuntimeThread>;
  clearThreadContext(threadId: string): Promise<RuntimeThread>;
  compactThreadContext(threadId: string): Promise<RuntimeThread>;
  sendTurn(threadId: string, input: SendTurnInput): Promise<SendTurnResponse>;
  updateMessage(threadId: string, messageId: string, patch: MessagePatch): Promise<RuntimeThread>;
  deleteMessages(threadId: string, input: MessageDeleteInput): Promise<RuntimeThread>;
  regenerateFromMessage(threadId: string, messageId: string, input: RegenerateMessageInput): Promise<SendTurnResponse>;
  cancelTurn(threadId: string, turnId: string): Promise<void>;
  subscribeEvents(
    threadId: string,
    sinceSeq: number | undefined,
    onEvent: (event: RuntimeEvent) => void,
  ): () => void;
  getConfig(): Promise<RuntimeConfigState>;
  saveConfig(input: RuntimeConfigInput): Promise<RuntimeConfigState>;
  fetchProviderModels(input: RuntimeFetchModelsInput): Promise<RuntimeAvailableModelsResponse>;
  listSkills(): Promise<RuntimeSkillList>;
  createSkill(input: RuntimeSkillInput): Promise<RuntimeSkillDetail>;
  getSkill(skillId: string): Promise<RuntimeSkillDetail>;
  updateSkill(skillId: string, patch: RuntimeSkillPatch): Promise<RuntimeSkillDetail>;
  deleteSkill(skillId: string): Promise<void>;
  listProjects(): Promise<WorkspaceProjectList>;
  addProject(input: AddWorkspaceProjectInput): Promise<WorkspaceProject>;
  removeProject(projectId: string): Promise<void>;
  getWorkspaceStatus(projectId?: string): Promise<WorkspaceStatus>;
  listProjectEntries(projectId: string, path?: string): Promise<WorkspaceEntryList>;
  searchProjectEntries(projectId: string, query?: string, parent?: string | null): Promise<WorkspaceEntrySearchResponse>;
  readProjectFile(projectId: string, path: string): Promise<WorkspaceFileRead>;
  searchProject(projectId: string, query: string): Promise<WorkspaceSearchResponse>;
  getUsage(query?: RuntimeUsageQuery): Promise<RuntimeUsageResponse>;
  listMemories(query?: RuntimeMemoryQuery): Promise<RuntimeMemoryList>;
  previewMemories(): Promise<RuntimeMemoryPreview>;
  createMemory(input: CreateRuntimeMemoryInput): Promise<RuntimeMemoryList>;
  deleteMemory(memoryId: string): Promise<void>;
  clearMemories(): Promise<RuntimeMemoryList>;
  listMcpServers(): Promise<RuntimeMcpServerList>;
  fetchMcpServerTools(input: RuntimeMcpServerInput): Promise<RuntimeMcpToolList>;
  upsertMcpServer(input: RuntimeMcpServerInput): Promise<RuntimeMcpServerList>;
  updateMcpServer(key: string, patch: RuntimeMcpServerPatch): Promise<RuntimeMcpServerList>;
  deleteMcpServer(key: string): Promise<void>;
  listApprovals(): Promise<RuntimeApprovalList>;
  answerApproval(approvalId: string, input: AnswerRuntimeApprovalInput): Promise<void>;
};
