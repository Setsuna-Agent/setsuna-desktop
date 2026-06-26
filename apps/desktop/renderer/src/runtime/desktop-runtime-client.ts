import type {
  AnswerRuntimeApprovalInput,
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RegenerateMessageInput,
  CreateRuntimeMemoryInput,
  DesktopRuntimeClient,
  RuntimeApprovalList,
  RuntimeMemoryList,
  RuntimeMemoryPreview,
  RuntimeMemoryQuery,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeFetchModelsInput,
  RuntimeAvailableModelsResponse,
  RuntimeEvent,
  RuntimeRequestInput,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillList,
  RuntimeSkillPatch,
  RuntimeThread,
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  SendTurnInput,
  SendTurnResponse,
  ThreadList,
  ThreadPatch,
  ThreadQuery,
  AddWorkspaceProjectInput,
  WorkspaceEntrySearchResponse,
  WorkspaceEntryList,
  WorkspaceFileRead,
  WorkspaceProject,
  WorkspaceProjectList,
  WorkspaceSearchResponse,
  WorkspaceStatus,
} from '@setsuna-desktop/contracts';

export function createDesktopRuntimeClient(): DesktopRuntimeClient {
  const bridge = window.setsunaDesktop?.runtime;
  if (!bridge) throw new Error('Desktop runtime bridge is unavailable.');

  const request = <T = unknown>(input: RuntimeRequestInput): Promise<T> => bridge.request<T>(input);

  return {
    request,
    listThreads(query: ThreadQuery = {}) {
      const params = new URLSearchParams();
      if (query.search) params.set('search', query.search);
      if (query.includeArchived) params.set('includeArchived', 'true');
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
      return request<SendTurnResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/turns`,
        method: 'POST',
        body: input,
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
    subscribeEvents(threadId: string, sinceSeq: number | undefined, onEvent: (event: RuntimeEvent) => void) {
      return bridge.startSse(threadId, sinceSeq, onEvent);
    },
    getConfig() {
      return request<RuntimeConfigState>({ path: '/v1/config' });
    },
    saveConfig(input: RuntimeConfigInput) {
      return request<RuntimeConfigState>({ path: '/v1/config', method: 'PUT', body: input });
    },
    fetchProviderModels(input: RuntimeFetchModelsInput) {
      return request<RuntimeAvailableModelsResponse>({ path: '/v1/config/models', method: 'POST', body: input });
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
    listProjects() {
      return request<WorkspaceProjectList>({ path: '/v1/projects' });
    },
    addProject(input: AddWorkspaceProjectInput) {
      return request<WorkspaceProject>({ path: '/v1/projects', method: 'POST', body: input });
    },
    removeProject(projectId: string) {
      return request<void>({ path: `/v1/projects/${encodeURIComponent(projectId)}`, method: 'DELETE' });
    },
    getWorkspaceStatus(projectId?: string) {
      const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
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
    listApprovals() {
      return request<RuntimeApprovalList>({ path: '/v1/approvals' });
    },
    answerApproval(approvalId: string, input: AnswerRuntimeApprovalInput) {
      return request<void>({ path: `/v1/approvals/${encodeURIComponent(approvalId)}`, method: 'POST', body: input });
    },
  };
}
