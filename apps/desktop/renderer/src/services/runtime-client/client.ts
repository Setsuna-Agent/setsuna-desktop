import type {
  AddWorkspaceProjectInput,
  AnswerRuntimeApprovalInput,
  CreateRuntimeMemoryInput,
  CreateThreadInput,
  DesktopRuntimeClient,
  MessageDeleteInput,
  MessagePatch,
  QueueTurnInput,
  QueuedTurnInputEditRelease,
  QueuedTurnInputEditReleaseResponse,
  QueuedTurnInputEditSession,
  QueuedTurnInputPatch,
  QueuedTurnInputResponse,
  DeleteQueuedTurnInputResponse,
  RegenerateMessageInput,
  RuntimeApprovalList,
  RuntimeAvailableModelsResponse,
  RuntimeBackgroundShellProcessList,
  RuntimeBackgroundShellProcessTermination,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeDebugTraceList,
  RuntimeEvent,
  RuntimeFetchModelsInput,
  RuntimeHookListResponse,
  RuntimeImageGenerationTestInput,
  RuntimeImageGenerationTestResult,
  RuntimeMcpResourceReadResult,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
  RuntimeMcpServerStatusList,
  RuntimeMcpToolCallResult,
  RuntimeMcpToolList,
  RuntimeMemoryList,
  RuntimeMemoryPreview,
  RuntimeMemoryQuery,
  RuntimePluginInstallResult,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginList,
  RuntimePluginMarketplaceList,
  RuntimePluginRemoveResult,
  RuntimeRequestInput,
  RuntimeReviewTarget,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillList,
  RuntimeSkillMcpDependencyInstallResult,
  RuntimeSkillPatch,
  RuntimeThread,
  RuntimeThreadGoal,
  RuntimeThreadGoalPatch,
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  RuntimeWorkspaceDependenciesStatus,
  RuntimeWorkspaceDependenciesToggleInput,
  SendTurnInput,
  SendTurnResponse,
  StartTurnResponse,
  SteerTurnInput,
  ThreadList,
  ThreadMemoryModePatch,
  ThreadPatch,
  ThreadQuery,
  WorkspaceEntryList,
  WorkspaceEntrySearchResponse,
  WorkspaceFileRead,
  WorkspaceProject,
  WorkspaceProjectList,
  WorkspaceSearchResponse,
  WorkspaceStatus,
} from '@setsuna-desktop/contracts';

/**
 * 基于 preload bridge 构造 renderer 侧 runtime client；renderer 永远不直接访问 runtime 端口。
 */
export function createDesktopRuntimeClient(): DesktopRuntimeClient {
  const bridge = window.setsunaDesktop?.runtime;
  if (!bridge) throw new Error('Desktop runtime bridge is unavailable.');

  // 底层 request 只留在适配器闭包内，避免 renderer 业务绕过窄 client 契约。
  const request = <T = unknown>(input: RuntimeRequestInput): Promise<T> => bridge.request<T>(input);

  return {
    uploadAttachment(input) {
      return bridge.uploadAttachment(input);
    },
    deleteAttachment(assetId) {
      return request({
        path: `/v1/attachments/${encodeURIComponent(assetId)}`,
        method: 'DELETE',
      });
    },
    listThreads(query: ThreadQuery = {}) {
      const params = new URLSearchParams();
      if (query.search) params.set('search', query.search);
      if (query.includeArchived) params.set('includeArchived', 'true');
      if (query.ancestorThreadId) params.set('ancestorThreadId', query.ancestorThreadId);
      if (query.parentThreadId) params.set('parentThreadId', query.parentThreadId);
      if (query.scope) params.set('scope', query.scope);
      if (query.projectId) params.set('projectId', query.projectId);
      const suffix = params.size ? `?${params}` : '';
      return request<ThreadList>({ path: `/v1/threads${suffix}` });
    },
    getThread(threadId: string) {
      return request<RuntimeThread>({ path: `/v1/threads/${encodeURIComponent(threadId)}` });
    },
    createThread(input: CreateThreadInput = {}) {
      return request<RuntimeThread>({ path: '/v1/threads', method: 'POST', body: input });
    },
    updateThread(threadId: string, patch: ThreadPatch) {
      return request<RuntimeThread>({
        path: `/v1/threads/${encodeURIComponent(threadId)}`,
        method: 'PATCH',
        body: patch,
      });
    },
    deleteThread(threadId: string) {
      return request<void>({
        path: `/v1/threads/${encodeURIComponent(threadId)}`,
        method: 'DELETE',
      });
    },
    listBackgroundShellProcesses(threadId: string) {
      return request<RuntimeBackgroundShellProcessList>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/background-shell-processes`,
      });
    },
    terminateBackgroundShellProcess(threadId: string, processId: string) {
      return request<RuntimeBackgroundShellProcessTermination>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/background-shell-processes/${encodeURIComponent(processId)}`,
        method: 'DELETE',
      });
    },
    setThreadGoal(threadId: string, patch: RuntimeThreadGoalPatch) {
      return request<RuntimeThreadGoal>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/goal`,
        method: 'PUT',
        body: patch,
      });
    },
    async clearThreadGoal(threadId: string) {
      const result = await request<{ cleared: boolean }>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/goal`,
        method: 'DELETE',
      });
      return result.cleared;
    },
    updateThreadMemoryMode(threadId: string, patch: ThreadMemoryModePatch) {
      return request<RuntimeThread>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/memory-mode`,
        method: 'PATCH',
        body: patch,
      });
    },
    clearThreadContext(threadId: string) {
      return request<RuntimeThread>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/context`,
        method: 'DELETE',
      });
    },
    compactThreadContext(threadId: string) {
      return request<RuntimeThread>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/context/compact`,
        method: 'POST',
      });
    },
    sendTurn(threadId: string, input: SendTurnInput) {
      return request<StartTurnResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/turns`,
        method: 'POST',
        body: input,
      });
    },
    steerTurn(threadId: string, turnId: string, input: SteerTurnInput) {
      return request<SendTurnResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/steer`,
        method: 'POST',
        body: input,
      });
    },
    queueTurnInput(threadId: string, input: QueueTurnInput) {
      return request<QueuedTurnInputResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/queued-turn-inputs`,
        method: 'POST',
        body: input,
      });
    },
    retrieveQueuedTurnInput(threadId: string, inputId: string) {
      return request<QueuedTurnInputEditSession>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/queued-turn-inputs/${encodeURIComponent(inputId)}/retrieve`,
        method: 'POST',
      });
    },
    releaseQueuedTurnInputEdit(threadId: string, inputId: string, input: QueuedTurnInputEditRelease) {
      return request<QueuedTurnInputEditReleaseResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/queued-turn-inputs/${encodeURIComponent(inputId)}/release`,
        method: 'POST',
        body: input,
      });
    },
    updateQueuedTurnInput(threadId: string, inputId: string, patch: QueuedTurnInputPatch) {
      return request<QueuedTurnInputResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/queued-turn-inputs/${encodeURIComponent(inputId)}`,
        method: 'PATCH',
        body: patch,
      });
    },
    deleteQueuedTurnInput(threadId: string, inputId: string) {
      return request<DeleteQueuedTurnInputResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/queued-turn-inputs/${encodeURIComponent(inputId)}`,
        method: 'DELETE',
      });
    },
    sendQueuedTurnInputNow(threadId: string, inputId: string) {
      return request<QueuedTurnInputResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/queued-turn-inputs/${encodeURIComponent(inputId)}/send-now`,
        method: 'POST',
      });
    },
    updateMessage(threadId: string, messageId: string, patch: MessagePatch) {
      return request<RuntimeThread>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
        method: 'PATCH',
        body: patch,
      });
    },
    deleteMessages(threadId: string, input: MessageDeleteInput) {
      return request<RuntimeThread>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/messages`,
        method: 'DELETE',
        body: input,
      });
    },
    regenerateFromMessage(threadId: string, messageId: string, input: RegenerateMessageInput) {
      return request<SendTurnResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/regenerate`,
        method: 'POST',
        body: input,
      });
    },
    cancelTurn(threadId: string, turnId: string) {
      return request<void>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/cancel`,
        method: 'POST',
      });
    },
    startReview(threadId: string, target: RuntimeReviewTarget) {
      return request<SendTurnResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/reviews`,
        method: 'POST',
        body: { target },
      });
    },
    subscribeEvents(threadId: string, sinceSeq: number | undefined, onEvent: (event: RuntimeEvent) => void) {
      return bridge.startSse(threadId, sinceSeq, onEvent);
    },
    listDebugTraces(threadId, afterSeq = 0) {
      const normalizedAfterSeq = Math.max(0, Math.floor(afterSeq));
      return request<RuntimeDebugTraceList>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/debug-traces?afterSeq=${normalizedAfterSeq}`,
      });
    },
    getConfig() {
      return request<RuntimeConfigState>({ path: '/v1/config' });
    },
    saveConfig(input: RuntimeConfigInput) {
      return request<RuntimeConfigState>({ path: '/v1/config', method: 'PUT', body: input });
    },
    getWorkspaceDependencies() {
      return request<RuntimeWorkspaceDependenciesStatus>({ path: '/v1/workspace-dependencies' });
    },
    setWorkspaceDependencies(input: RuntimeWorkspaceDependenciesToggleInput) {
      return request<RuntimeWorkspaceDependenciesStatus>({ path: '/v1/workspace-dependencies', method: 'PUT', body: input });
    },
    diagnoseWorkspaceDependencies() {
      return request<RuntimeWorkspaceDependenciesStatus>({ path: '/v1/workspace-dependencies/diagnose', method: 'POST' });
    },
    reinstallWorkspaceDependencies() {
      return request<RuntimeWorkspaceDependenciesStatus>({ path: '/v1/workspace-dependencies/reinstall', method: 'POST' });
    },
    fetchProviderModels(input: RuntimeFetchModelsInput) {
      return request<RuntimeAvailableModelsResponse>({ path: '/v1/config/models', method: 'POST', body: input });
    },
    listHooks(cwds: string[] = []) {
      const params = new URLSearchParams();
      for (const cwd of cwds) params.append('cwd', cwd);
      const suffix = params.size ? `?${params}` : '';
      return request<RuntimeHookListResponse>({ path: `/v1/hooks${suffix}` });
    },
    listSkills() {
      return request<RuntimeSkillList>({ path: '/v1/skills' });
    },
    createSkill(input: RuntimeSkillInput) {
      return request<RuntimeSkillDetail>({ path: '/v1/skills', method: 'POST', body: input });
    },
    getSkill(skillId: string) {
      return request<RuntimeSkillDetail>({ path: `/v1/skills/${encodeURIComponent(skillId)}` });
    },
    updateSkill(skillId: string, patch: RuntimeSkillPatch) {
      return request<RuntimeSkillDetail>({
        path: `/v1/skills/${encodeURIComponent(skillId)}`,
        method: 'PATCH',
        body: patch,
      });
    },
    deleteSkill(skillId: string) {
      return request<void>({
        path: `/v1/skills/${encodeURIComponent(skillId)}`,
        method: 'DELETE',
      });
    },
    installSkillMcpDependencies(skillId: string) {
      return request<RuntimeSkillMcpDependencyInstallResult>({
        path: `/v1/skills/${encodeURIComponent(skillId)}/mcp-dependencies/install`,
        method: 'POST',
      });
    },
    authenticateSkillMcpDependency(skillId: string, serverKey: string) {
      return request<RuntimeSkillDetail>({
        path: `/v1/skills/${encodeURIComponent(skillId)}/mcp-dependencies/${encodeURIComponent(serverKey)}/login`,
        method: 'POST',
      });
    },
    listPlugins() {
      return request<RuntimePluginList>({ path: '/v1/plugins' });
    },
    listPluginMarketplace() {
      return request<RuntimePluginMarketplaceList>({ path: '/v1/plugin-marketplace' });
    },
    getPluginItemContent(pluginId: string, kind: RuntimePluginItemKind, itemId: string) {
      return request<RuntimePluginItemContent>({
        path: `/v1/plugins/${encodeURIComponent(pluginId)}/items/${kind}/${encodeURIComponent(itemId)}`,
      });
    },
    getMarketplacePluginItemContent(pluginId: string, kind: RuntimePluginItemKind, itemId: string) {
      return request<RuntimePluginItemContent>({
        path: `/v1/plugin-marketplace/${encodeURIComponent(pluginId)}/items/${kind}/${encodeURIComponent(itemId)}`,
      });
    },
    installMarketplacePlugin(pluginId: string) {
      return request<RuntimePluginInstallResult>({
        path: `/v1/plugin-marketplace/${encodeURIComponent(pluginId)}/install`,
        method: 'POST',
      });
    },
    updateMarketplacePlugin(pluginId: string) {
      return request<RuntimePluginInstallResult>({
        path: `/v1/plugin-marketplace/${encodeURIComponent(pluginId)}/update`,
        method: 'POST',
      });
    },
    removePlugin(pluginId: string) {
      return request<RuntimePluginRemoveResult>({
        path: `/v1/plugins/${encodeURIComponent(pluginId)}`,
        method: 'DELETE',
      });
    },
    testImageGeneration(input: RuntimeImageGenerationTestInput) {
      return request<RuntimeImageGenerationTestResult>({
        path: '/v1/plugins/openai-image-generation/test',
        method: 'POST',
        body: input,
      });
    },
    listProjects() {
      return request<WorkspaceProjectList>({ path: '/v1/projects' });
    },
    addProject(input: AddWorkspaceProjectInput) {
      return request<WorkspaceProject>({ path: '/v1/projects', method: 'POST', body: input });
    },
    archiveProject(projectId: string) {
      return request<void>({ path: `/v1/projects/${encodeURIComponent(projectId)}/archive`, method: 'POST' });
    },
    removeProject(projectId: string) {
      return request<void>({ path: `/v1/projects/${encodeURIComponent(projectId)}`, method: 'DELETE' });
    },
    getWorkspaceStatus(query = {}) {
      const params = new URLSearchParams();
      if (query.projectId) params.set('projectId', query.projectId);
      if (query.threadId) params.set('threadId', query.threadId);
      const suffix = params.size ? `?${params}` : '';
      return request<WorkspaceStatus>({ path: `/v1/workspace/status${suffix}` });
    },
    listProjectEntries(projectId: string, path = '.') {
      return request<WorkspaceEntryList>({
        path: `/v1/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(path)}`,
      });
    },
    searchProjectEntries(projectId: string, query = '', parent?: string | null) {
      const params = new URLSearchParams();
      params.set('q', query);
      if (parent !== undefined && parent !== null) params.set('parent', parent);
      return request<WorkspaceEntrySearchResponse>({
        path: `/v1/projects/${encodeURIComponent(projectId)}/entries/search?${params}`,
      });
    },
    readProjectFile(projectId: string, path: string) {
      return request<WorkspaceFileRead>({
        path: `/v1/projects/${encodeURIComponent(projectId)}/read?path=${encodeURIComponent(path)}`,
      });
    },
    searchProject(projectId: string, query: string) {
      return request<WorkspaceSearchResponse>({
        path: `/v1/projects/${encodeURIComponent(projectId)}/search?q=${encodeURIComponent(query)}`,
      });
    },
    getUsage(query: RuntimeUsageQuery = {}) {
      const params = new URLSearchParams();
      if (query.threadId) params.set('threadId', query.threadId);
      if (typeof query.limit === 'number') params.set('limit', String(query.limit));
      const suffix = params.size ? `?${params}` : '';
      return request<RuntimeUsageResponse>({ path: `/v1/usage${suffix}` });
    },
    listMemories(query: RuntimeMemoryQuery = {}) {
      const params = new URLSearchParams();
      if (query.scope) params.set('scope', query.scope);
      if (query.projectId) params.set('projectId', query.projectId);
      if (query.search) params.set('search', query.search);
      if (typeof query.limit === 'number') params.set('limit', String(query.limit));
      const suffix = params.size ? `?${params}` : '';
      return request<RuntimeMemoryList>({ path: `/v1/memories${suffix}` });
    },
    previewMemories() {
      return request<RuntimeMemoryPreview>({ path: '/v1/memories/preview' });
    },
    createMemory(input: CreateRuntimeMemoryInput) {
      return request<RuntimeMemoryList>({ path: '/v1/memories', method: 'POST', body: input });
    },
    deleteMemory(memoryId: string) {
      return request<void>({ path: `/v1/memories/${encodeURIComponent(memoryId)}`, method: 'DELETE' });
    },
    clearMemories() {
      return request<RuntimeMemoryList>({ path: '/v1/memories', method: 'DELETE' });
    },
    listMcpServers() {
      return request<RuntimeMcpServerList>({ path: '/v1/mcp/servers' });
    },
    fetchMcpServerTools(input: RuntimeMcpServerInput) {
      return request<RuntimeMcpToolList>({ path: '/v1/mcp/tools', method: 'POST', body: input });
    },
    upsertMcpServer(input: RuntimeMcpServerInput) {
      return request<RuntimeMcpServerList>({ path: '/v1/mcp/servers', method: 'POST', body: input });
    },
    updateMcpServer(key: string, patch: RuntimeMcpServerPatch) {
      return request<RuntimeMcpServerList>({
        path: `/v1/mcp/servers/${encodeURIComponent(key)}`,
        method: 'PATCH',
        body: patch,
      });
    },
    deleteMcpServer(key: string) {
      return request<void>({ path: `/v1/mcp/servers/${encodeURIComponent(key)}`, method: 'DELETE' });
    },
    loginMcpServer(key: string) {
      return request<RuntimeMcpServerList>({ path: `/v1/mcp/servers/${encodeURIComponent(key)}/oauth/login`, method: 'POST' });
    },
    logoutMcpServer(key: string) {
      return request<RuntimeMcpServerList>({ path: `/v1/mcp/servers/${encodeURIComponent(key)}/oauth/logout`, method: 'POST' });
    },
    listMcpServerStatuses() {
      return request<RuntimeMcpServerStatusList>({ path: '/v1/mcp/statuses' });
    },
    readMcpServerResource(threadId: string, server: string, uri: string) {
      return request<RuntimeMcpResourceReadResult>({
        path: '/v1/mcp/resources/read',
        method: 'POST',
        body: { threadId, server, uri },
      });
    },
    callMcpServerTool(threadId: string, server: string, tool: string, args?: unknown) {
      return request<RuntimeMcpToolCallResult>({
        path: '/v1/mcp/tools/call',
        method: 'POST',
        body: {
          threadId,
          server,
          tool,
          arguments: args ?? {},
        },
      });
    },
    setSkillExtraRoots(extraRoots: string[]) {
      return request<void>({
        path: '/v1/skills/extra-roots',
        method: 'PUT',
        body: { extraRoots },
      });
    },
    listApprovals() {
      return request<RuntimeApprovalList>({ path: '/v1/approvals' });
    },
    answerApproval(approvalId: string, input: AnswerRuntimeApprovalInput) {
      return request<void>({ path: `/v1/approvals/${encodeURIComponent(approvalId)}`, method: 'POST', body: input });
    },
  };
}
