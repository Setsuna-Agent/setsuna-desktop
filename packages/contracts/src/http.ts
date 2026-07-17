import type { AnswerRuntimeApprovalInput, RuntimeApprovalList } from './approvals.js';
import type { RuntimeAvailableModelsResponse, RuntimeConfigInput, RuntimeConfigState, RuntimeFetchModelsInput, RuntimeHookListResponse } from './config.js';
import type { RuntimeEvent } from './events.js';
import type { CreateRuntimeMemoryInput, RuntimeMemoryList, RuntimeMemoryPreview, RuntimeMemoryQuery } from './memory.js';
import type {
  RuntimeMcpResourceReadResult,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
  RuntimeMcpServerStatusList,
  RuntimeMcpToolCallResult,
  RuntimeMcpToolList,
} from './mcp.js';
import type {
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginInstallResult,
  RuntimePluginList,
  RuntimePluginMarketplaceList,
  RuntimePluginRemoveResult,
} from './plugins.js';
import type { RuntimeSkillDetail, RuntimeSkillInput, RuntimeSkillList, RuntimeSkillMcpDependencyInstallResult, RuntimeSkillPatch } from './skills.js';
import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RegenerateMessageInput,
  RuntimeReviewTarget,
  RuntimeThread,
  RuntimeThreadGoal,
  RuntimeThreadGoalPatch,
  SendTurnInput,
  SendTurnResponse,
  SteerTurnInput,
  ThreadList,
  ThreadMemoryModePatch,
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
import type { RuntimeWorkspaceDependenciesStatus, RuntimeWorkspaceDependenciesToggleInput } from './workspace-dependencies.js';

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
  deleteThread(threadId: string): Promise<void>;
  setThreadGoal(threadId: string, patch: RuntimeThreadGoalPatch): Promise<RuntimeThreadGoal>;
  clearThreadGoal(threadId: string): Promise<boolean>;
  updateThreadMemoryMode(threadId: string, patch: ThreadMemoryModePatch): Promise<RuntimeThread>;
  clearThreadContext(threadId: string): Promise<RuntimeThread>;
  compactThreadContext(threadId: string): Promise<RuntimeThread>;
  sendTurn(threadId: string, input: SendTurnInput): Promise<SendTurnResponse>;
  steerTurn(threadId: string, turnId: string, input: SteerTurnInput): Promise<SendTurnResponse>;
  updateMessage(threadId: string, messageId: string, patch: MessagePatch): Promise<RuntimeThread>;
  deleteMessages(threadId: string, input: MessageDeleteInput): Promise<RuntimeThread>;
  regenerateFromMessage(threadId: string, messageId: string, input: RegenerateMessageInput): Promise<SendTurnResponse>;
  cancelTurn(threadId: string, turnId: string): Promise<void>;
  startReview(threadId: string, target: RuntimeReviewTarget): Promise<SendTurnResponse>;
  subscribeEvents(
    threadId: string,
    sinceSeq: number | undefined,
    onEvent: (event: RuntimeEvent) => void,
  ): () => void;
  getConfig(): Promise<RuntimeConfigState>;
  saveConfig(input: RuntimeConfigInput): Promise<RuntimeConfigState>;
  getWorkspaceDependencies(): Promise<RuntimeWorkspaceDependenciesStatus>;
  setWorkspaceDependencies(input: RuntimeWorkspaceDependenciesToggleInput): Promise<RuntimeWorkspaceDependenciesStatus>;
  diagnoseWorkspaceDependencies(): Promise<RuntimeWorkspaceDependenciesStatus>;
  reinstallWorkspaceDependencies(): Promise<RuntimeWorkspaceDependenciesStatus>;
  fetchProviderModels(input: RuntimeFetchModelsInput): Promise<RuntimeAvailableModelsResponse>;
  listHooks(cwds?: string[]): Promise<RuntimeHookListResponse>;
  listSkills(): Promise<RuntimeSkillList>;
  createSkill(input: RuntimeSkillInput): Promise<RuntimeSkillDetail>;
  getSkill(skillId: string): Promise<RuntimeSkillDetail>;
  updateSkill(skillId: string, patch: RuntimeSkillPatch): Promise<RuntimeSkillDetail>;
  deleteSkill(skillId: string): Promise<void>;
  installSkillMcpDependencies(skillId: string): Promise<RuntimeSkillMcpDependencyInstallResult>;
  authenticateSkillMcpDependency(skillId: string, serverKey: string): Promise<RuntimeSkillDetail>;
  listPlugins(): Promise<RuntimePluginList>;
  listPluginMarketplace(): Promise<RuntimePluginMarketplaceList>;
  getPluginItemContent(pluginId: string, kind: RuntimePluginItemKind, itemId: string): Promise<RuntimePluginItemContent>;
  getMarketplacePluginItemContent(pluginId: string, kind: RuntimePluginItemKind, itemId: string): Promise<RuntimePluginItemContent>;
  installMarketplacePlugin(pluginId: string): Promise<RuntimePluginInstallResult>;
  removePlugin(pluginId: string): Promise<RuntimePluginRemoveResult>;
  listProjects(): Promise<WorkspaceProjectList>;
  addProject(input: AddWorkspaceProjectInput): Promise<WorkspaceProject>;
  archiveProject(projectId: string): Promise<void>;
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
  loginMcpServer(key: string): Promise<RuntimeMcpServerList>;
  logoutMcpServer(key: string): Promise<RuntimeMcpServerList>;
  listMcpServerStatuses(): Promise<RuntimeMcpServerStatusList>;
  readMcpServerResource(threadId: string, server: string, uri: string): Promise<RuntimeMcpResourceReadResult>;
  callMcpServerTool(threadId: string, server: string, tool: string, args?: unknown): Promise<RuntimeMcpToolCallResult>;
  setSkillExtraRoots(extraRoots: string[]): Promise<void>;
  listApprovals(): Promise<RuntimeApprovalList>;
  answerApproval(approvalId: string, input: AnswerRuntimeApprovalInput): Promise<void>;
};
