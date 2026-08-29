import type {
  AddWorkspaceProjectInput,
  UpdateWorkspaceProjectInput,
  AnswerRuntimeApprovalInput,
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
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeMessagePage,
  RuntimeMessagePageQuery,
  RuntimeRequestInput,
  RuntimeReviewStartInput,
  RuntimeThread,
  SendTurnInput,
  SendTurnResponse,
  StartTurnResponse,
  SteerTurnInput,
  ThreadList,
  ThreadPatch,
  ThreadQuery,
  WorkspaceEntryList,
  WorkspaceEntrySearchResponse,
  WorkspaceFileRead,
  WorkspaceFileSaveInput,
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
    linkAttachment(file) {
      return bridge.linkAttachment(file);
    },
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
      return request<RuntimeThread>({
        path: `/v1/threads/${encodeURIComponent(threadId)}?messageLimit=160`,
      });
    },
    listThreadMessages(threadId: string, query: RuntimeMessagePageQuery = {}) {
      const params = new URLSearchParams();
      if (query.before !== undefined) params.set('before', String(query.before));
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const suffix = params.size ? `?${params}` : '';
      return request<RuntimeMessagePage>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/messages${suffix}`,
      });
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
    startReview(threadId: string, input: RuntimeReviewStartInput) {
      return request<SendTurnResponse>({
        path: `/v1/threads/${encodeURIComponent(threadId)}/reviews`,
        method: 'POST',
        body: input,
      });
    },
    subscribeEvents(threadId, sinceSeq, onBatch) {
      return bridge.startSse(threadId, sinceSeq, onBatch);
    },
    getConfig() {
      return request<RuntimeConfigState>({ path: '/v1/config' });
    },
    saveConfig(input: RuntimeConfigInput) {
      return request<RuntimeConfigState>({ path: '/v1/config', method: 'PUT', body: input });
    },
    listProjects() {
      return request<WorkspaceProjectList>({ path: '/v1/projects' });
    },
    addProject(input: AddWorkspaceProjectInput) {
      return request<WorkspaceProject>({ path: '/v1/projects', method: 'POST', body: input });
    },
    updateProject(projectId: string, input: UpdateWorkspaceProjectInput) {
      return request<WorkspaceProject>({
        path: `/v1/projects/${encodeURIComponent(projectId)}`,
        method: 'PATCH',
        body: input,
      });
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
    readProjectFileForEdit(projectId: string, path: string) {
      return request<WorkspaceFileRead>({
        path: `/v1/projects/${encodeURIComponent(projectId)}/read?path=${encodeURIComponent(path)}&mode=edit`,
      });
    },
    saveProjectFile(projectId: string, path: string, input: WorkspaceFileSaveInput) {
      return request<WorkspaceFileRead>({
        path: `/v1/projects/${encodeURIComponent(projectId)}/write?path=${encodeURIComponent(path)}`,
        method: 'PUT',
        body: input,
      });
    },
    searchProject(projectId: string, query: string) {
      return request<WorkspaceSearchResponse>({
        path: `/v1/projects/${encodeURIComponent(projectId)}/search?q=${encodeURIComponent(query)}`,
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
