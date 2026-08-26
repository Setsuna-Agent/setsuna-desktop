import type { AnswerRuntimeApprovalInput, RuntimeApprovalList } from './approvals.js';
import type {
  RuntimeAttachmentDeleteResponse,
  RuntimeAttachmentUploadInput,
  RuntimeStoredMessageAttachment,
} from './attachments.js';
import type {
  RuntimeBackgroundShellProcessList,
  RuntimeBackgroundShellProcessTermination,
} from './background-shell-processes.js';
import type {
  RuntimeAvailableModelsResponse,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeConfiguredModelReference,
  RuntimeFetchModelsInput,
  RuntimeHookListResponse,
  RuntimeInterfaceLanguage,
} from './config.js';
import type { RuntimeEventBatch } from './events.js';
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
  RuntimeExtensionStatusList,
  RuntimeExtensionTrustInput,
  RuntimePluginInstallResult,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginList,
  RuntimePluginMarketplaceList,
  RuntimePluginRemoveResult,
} from './plugins.js';
import type {
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillList,
  RuntimeSkillMcpDependencyInstallResult,
  RuntimeSkillPatch,
} from './skills.js';
import type {
  CreateThreadInput,
  DeleteQueuedTurnInputResponse,
  MessageDeleteInput,
  MessagePatch,
  QueuedTurnInputEditRelease,
  QueuedTurnInputEditReleaseResponse,
  RuntimeMessagePage,
  RuntimeMessagePageQuery,
  QueuedTurnInputEditSession,
  QueuedTurnInputPatch,
  QueuedTurnInputResponse,
  QueueTurnInput,
  RegenerateMessageInput,
  RuntimeReviewTarget,
  RuntimeThread,
  SendTurnInput,
  SendTurnResponse,
  StartTurnResponse,
  SteerTurnInput,
  ThreadList,
  ThreadPatch,
  ThreadQuery,
} from './threads.js';
import type {
  AddWorkspaceProjectInput,
  UpdateWorkspaceProjectInput,
  WorkspaceEntryList,
  WorkspaceEntrySearchResponse,
  WorkspaceFileRead,
  WorkspaceFileSaveInput,
  WorkspaceProject,
  WorkspaceProjectList,
  WorkspaceSearchResponse,
  WorkspaceStatus,
  WorkspaceStatusQuery,
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
  /** Correlates a renderer AbortSignal with the private localhost request in main. */
  requestId?: string;
  /** Preserves typed Feature failures across Electron IPC. */
  responseMode?: 'body' | 'feature-operation';
};

export type RuntimeFeatureOperationResponse<TValue = unknown> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{
      ok: false;
      status: number;
      error: Readonly<{
        code: string;
        message: string;
        retryable: boolean;
        details?: unknown;
      }>;
    }>;

export type RuntimeReviewStartInput = {
  language?: RuntimeInterfaceLanguage;
  modelSelection?: RuntimeConfiguredModelReference;
  target: RuntimeReviewTarget;
};

export type DesktopRuntimeClient = {
  linkAttachment(file: File): Promise<RuntimeStoredMessageAttachment | null>;
  uploadAttachment(input: RuntimeAttachmentUploadInput): Promise<RuntimeStoredMessageAttachment>;
  deleteAttachment(assetId: string): Promise<RuntimeAttachmentDeleteResponse>;
  listThreads(query?: ThreadQuery): Promise<ThreadList>;
  getThread(threadId: string): Promise<RuntimeThread>;
  listThreadMessages(threadId: string, query?: RuntimeMessagePageQuery): Promise<RuntimeMessagePage>;
  createThread(input?: CreateThreadInput): Promise<RuntimeThread>;
  createSideConversation(parentThreadId: string): Promise<RuntimeThread>;
  updateThread(threadId: string, patch: ThreadPatch): Promise<RuntimeThread>;
  deleteThread(threadId: string): Promise<void>;
  listBackgroundShellProcesses(threadId: string): Promise<RuntimeBackgroundShellProcessList>;
  terminateBackgroundShellProcess(threadId: string, processId: string): Promise<RuntimeBackgroundShellProcessTermination>;
  clearThreadContext(threadId: string): Promise<RuntimeThread>;
  compactThreadContext(threadId: string): Promise<RuntimeThread>;
  sendTurn(threadId: string, input: SendTurnInput): Promise<StartTurnResponse>;
  steerTurn(threadId: string, turnId: string, input: SteerTurnInput): Promise<SendTurnResponse>;
  queueTurnInput(threadId: string, input: QueueTurnInput): Promise<QueuedTurnInputResponse>;
  retrieveQueuedTurnInput(threadId: string, inputId: string): Promise<QueuedTurnInputEditSession>;
  releaseQueuedTurnInputEdit(threadId: string, inputId: string, input: QueuedTurnInputEditRelease): Promise<QueuedTurnInputEditReleaseResponse>;
  updateQueuedTurnInput(threadId: string, inputId: string, patch: QueuedTurnInputPatch): Promise<QueuedTurnInputResponse>;
  deleteQueuedTurnInput(threadId: string, inputId: string): Promise<DeleteQueuedTurnInputResponse>;
  sendQueuedTurnInputNow(threadId: string, inputId: string): Promise<QueuedTurnInputResponse>;
  updateMessage(threadId: string, messageId: string, patch: MessagePatch): Promise<RuntimeThread>;
  deleteMessages(threadId: string, input: MessageDeleteInput): Promise<RuntimeThread>;
  regenerateFromMessage(threadId: string, messageId: string, input: RegenerateMessageInput): Promise<SendTurnResponse>;
  cancelTurn(threadId: string, turnId: string): Promise<void>;
  startReview(threadId: string, input: RuntimeReviewStartInput): Promise<SendTurnResponse>;
  subscribeEvents(
    threadId: string,
    sinceSeq: number | undefined,
    onBatch: (batch: RuntimeEventBatch) => void,
  ): () => void;
  getConfig(): Promise<RuntimeConfigState>;
  saveConfig(input: RuntimeConfigInput): Promise<RuntimeConfigState>;
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
  updateMarketplacePlugin(pluginId: string): Promise<RuntimePluginInstallResult>;
  removePlugin(pluginId: string): Promise<RuntimePluginRemoveResult>;
  listExtensionStatuses(): Promise<RuntimeExtensionStatusList>;
  setPluginExtensionTrust(pluginId: string, input: RuntimeExtensionTrustInput): Promise<RuntimePluginList>;
  listProjects(): Promise<WorkspaceProjectList>;
  addProject(input: AddWorkspaceProjectInput): Promise<WorkspaceProject>;
  updateProject(projectId: string, input: UpdateWorkspaceProjectInput): Promise<WorkspaceProject>;
  archiveProject(projectId: string): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  getWorkspaceStatus(query?: WorkspaceStatusQuery): Promise<WorkspaceStatus>;
  listProjectEntries(projectId: string, path?: string): Promise<WorkspaceEntryList>;
  searchProjectEntries(projectId: string, query?: string, parent?: string | null): Promise<WorkspaceEntrySearchResponse>;
  readProjectFile(projectId: string, path: string): Promise<WorkspaceFileRead>;
  readProjectFileForEdit(projectId: string, path: string): Promise<WorkspaceFileRead>;
  saveProjectFile(projectId: string, path: string, input: WorkspaceFileSaveInput): Promise<WorkspaceFileRead>;
  searchProject(projectId: string, query: string): Promise<WorkspaceSearchResponse>;
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
