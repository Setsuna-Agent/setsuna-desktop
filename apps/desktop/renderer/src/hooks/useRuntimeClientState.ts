import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  ProviderConfigState,
  RuntimeAvailableModelsResponse,
  RuntimeApprovalRequest,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeEvent,
  RuntimeFetchModelsInput,
  RuntimeMemoryPreview,
  RuntimeMemoryRecord,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpToolList,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillSummary,
  RuntimeThread,
  RuntimeThreadSummary,
  RuntimeToolRun,
  RuntimeUsageResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { createDesktopRuntimeClient } from '../runtime/desktop-runtime-client.js';
import { applyRuntimeEvent, isActivityEvent } from '../utils/runtimeEvents.js';

export type LoadState = 'loading' | 'ready' | 'error';

type RuntimeClientStateOptions = {
  activeProjectId: string | null;
  setActiveProjectId: Dispatch<SetStateAction<string | null>>;
};

/**
 * 维护 renderer 侧所有跨 runtime bridge 的状态，并协调 REST 快照与 SSE 增量事件。
 *
 * @param activeProjectId 当前 renderer 选中的项目 ID。
 * @param setActiveProjectId 更新当前项目 ID 的 React setter。
 */
export function useRuntimeClientState({ activeProjectId, setActiveProjectId }: RuntimeClientStateOptions) {
  const client = useMemo(() => createDesktopRuntimeClient(), []);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [threads, setThreads] = useState<RuntimeThreadSummary[]>([]);
  const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(null);
  const [config, setConfig] = useState<RuntimeConfigState | null>(null);
  const [contextCompacting, setContextCompacting] = useState(false);
  const [approvals, setApprovals] = useState<RuntimeApprovalRequest[]>([]);
  const [activityEvents, setActivityEvents] = useState<RuntimeEvent[]>([]);
  const [usage, setUsage] = useState<RuntimeUsageResponse | null>(null);
  const [memories, setMemories] = useState<RuntimeMemoryRecord[]>([]);
  const [memoryPreview, setMemoryPreview] = useState<RuntimeMemoryPreview | null>(null);
  const [memoryPreviewLoading, setMemoryPreviewLoading] = useState(false);
  const [skills, setSkills] = useState<RuntimeSkillSummary[]>([]);
  const [mcpState, setMcpState] = useState<RuntimeMcpServerList | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const initializedSelectionRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  // SSE 订阅从这个 seq 续接，组件重挂载时不会重复应用已处理事件。
  const currentThreadLastSeqRef = useRef(0);
  const threadListRefreshTimerRef = useRef<number | null>(null);
  // 终态 turn 记录在本地，避免延迟快照把已完成 turn 重新推断成 active。
  const terminalTurnIdsRef = useRef<Set<string>>(new Set());
  const currentThreadId = currentThread?.id ?? null;
  const effectiveActiveTurnId = activeTurnId ?? inferActiveTurnIdFromThread(currentThread, terminalTurnIdsRef.current);
  currentThreadLastSeqRef.current = currentThread?.lastSeq ?? 0;

  const refresh = useCallback(async () => {
    setError(null);
    // 首屏需要多个 runtime 域的数据；并行拉取能避免设置页/侧栏/对话区分批闪烁。
    const [nextConfig, threadList, skillList, mcpList, projectList, usageSummary, memoryList, approvalList] = await Promise.all([
      client.getConfig(),
      client.listThreads(),
      client.listSkills(),
      client.listMcpServers(),
      client.listProjects(),
      client.getUsage(),
      client.listMemories({ limit: 20 }),
      client.listApprovals(),
    ]);
    setConfig(nextConfig);
    setThreads(threadList.threads);
    setSkills(skillList.skills);
    setMcpState(mcpList);
    setProjects(projectList.projects);
    setUsage(usageSummary);
    setMemories(memoryList.memories);
    setApprovals(approvalList.approvals);

    if (!initializedSelectionRef.current) {
      initializedSelectionRef.current = true;
      const initialThread = threadList.threads.find((thread) => !thread.projectId) ?? threadList.threads[0];
      if (initialThread) {
        const thread = await client.getThread(initialThread.id);
        setCurrentThread(thread);
        setActiveProjectId(thread.projectId ?? null);
      } else {
        setActiveProjectId((current) => current ?? projectList.projects[0]?.id ?? null);
      }
    }

    setLoadState('ready');
  }, [client, setActiveProjectId]);

  useEffect(() => {
    refresh().catch((unknownError) => {
      setLoadState('error');
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    });
  }, [refresh]);

  const refreshThreadsSoon = useCallback(() => {
    if (threadListRefreshTimerRef.current !== null) return;
    // 线程列表摘要不需要每条 SSE 都立即刷新，短 debounce 足够保持侧栏一致。
    threadListRefreshTimerRef.current = window.setTimeout(() => {
      threadListRefreshTimerRef.current = null;
      void client
        .listThreads()
        .then((list) => setThreads(list.threads))
        .catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
    }, 120);
  }, [client]);

  const refreshCapabilities = useCallback(() => {
    void Promise.all([client.listSkills(), client.listMcpServers()])
      .then(([skillList, mcpList]) => {
        setSkills(skillList.skills);
        setMcpState(mcpList);
      })
      .catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
  }, [client]);

  useEffect(() => () => {
    if (threadListRefreshTimerRef.current !== null) {
      window.clearTimeout(threadListRefreshTimerRef.current);
      threadListRefreshTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    unsubscribeRef.current?.();
    if (!currentThreadId) return undefined;
    // 当前线程以 SSE 增量为主，侧栏/list 摘要再通过短 debounce 刷新。
    unsubscribeRef.current = client.subscribeEvents(currentThreadId, currentThreadLastSeqRef.current, (event) => {
      setCurrentThread((thread) => {
        if (!thread || thread.id !== event.threadId || event.seq <= thread.lastSeq) return thread;
        return applyRuntimeEvent(thread, event);
      });
      if (isActivityEvent(event)) {
        setActivityEvents((items) => [event, ...items.filter((item) => item.id !== event.id)].slice(0, 80));
      }
      refreshThreadsSoon();
      if (event.type === 'turn.started' && event.turnId) {
        terminalTurnIdsRef.current.delete(event.turnId);
        setActiveTurnId(event.turnId);
      }
      if ((event.type === 'turn.completed' || event.type === 'turn.cancelled' || event.type === 'runtime.error') && event.turnId) {
        // runtime.error 也视作 turn 终态，否则 polling/infer 可能继续显示停止按钮。
        terminalTurnIdsRef.current.add(event.turnId);
        setActiveTurnId((current) => (current === event.turnId ? null : current));
      }
      if (event.type === 'runtime.error') {
        setError(event.payload.message);
      }
      if (event.type === 'turn.completed') {
        refreshCapabilities();
        if (event.payload.usage) void client.getUsage().then(setUsage);
      }
      if (event.type === 'approval.requested') {
        setApprovals((items) => [event.payload.approval, ...items.filter((item) => item.id !== event.payload.approval.id)]);
      }
      if (event.type === 'approval.resolved') {
        setApprovals((items) =>
          items.map((item) =>
            item.id === event.payload.approvalId
              ? {
                  ...item,
                  status: event.payload.decision === 'approve' ? 'approved' : 'rejected',
                  message: event.payload.message,
                }
              : item,
          ),
        );
      }
    });
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [client, currentThreadId, refreshCapabilities, refreshThreadsSoon]);

  useEffect(() => {
    setActivityEvents([]);
    terminalTurnIdsRef.current.clear();
    setActiveTurnId(null);
  }, [currentThread?.id]);

  useEffect(() => {
    if (!effectiveActiveTurnId || !currentThreadId) return undefined;
    let cancelled = false;
    let timeoutId: number | undefined;
    const threadId = currentThreadId;
    const turnId = effectiveActiveTurnId;

    // polling 是 SSE 丢帧或 renderer 恢复时的兜底路径，防止运行中的 turn 卡在旧状态。
    const pollThread = async () => {
      try {
        const nextThread = await client.getThread(threadId);
        if (cancelled) return;
        setCurrentThread((thread) => (thread?.id === threadId && nextThread.lastSeq >= thread.lastSeq ? nextThread : thread));
        refreshThreadsSoon();
        if (turnHasFinished(nextThread, turnId)) {
          terminalTurnIdsRef.current.add(turnId);
          setActiveTurnId((current) => (current === turnId ? null : current));
          refreshCapabilities();
          void client.getUsage().then(setUsage);
          return;
        }
      } catch (unknownError) {
        if (!cancelled) setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
      if (!cancelled) timeoutId = window.setTimeout(pollThread, 1000);
    };

    timeoutId = window.setTimeout(pollThread, 250);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [effectiveActiveTurnId, client, currentThreadId, refreshCapabilities, refreshThreadsSoon]);

  useEffect(() => {
    client
      .listMemories({ projectId: activeProjectId ?? undefined, limit: 20 })
      .then((result) => setMemories(result.memories))
      .catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
  }, [activeProjectId, client]);

  const reloadThreads = useCallback(async () => {
    const list = await client.listThreads();
    setThreads(list.threads);
    return list.threads;
  }, [client]);

  const saveProviders = useCallback(
    async (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => {
      const activeProviderId = providers.some((provider) => provider.id === config?.activeProviderId)
        ? config?.activeProviderId
        : providers.find((provider) => provider.enabled)?.id ?? providers[0]?.id;
      const next = await client.saveConfig({
        activeProviderId,
        providers: providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          provider: provider.provider,
          baseUrl: provider.baseUrl,
          enabled: provider.enabled,
          apiKey: apiKeysByProviderId[provider.id] || undefined,
          models: provider.models,
        })),
      });
      setConfig(next);
    },
    [client, config?.activeProviderId],
  );

  const saveRuntimePreferences = useCallback(
    async (input: Pick<RuntimeConfigInput, 'globalPrompt' | 'storagePath' | 'memoryEnabled' | 'setsunaStyle' | 'approvalPolicy' | 'permissionProfile'>) => {
      const next = await client.saveConfig(input);
      setConfig(next);
      if (Object.hasOwn(input, 'storagePath')) {
        const list = await client.listMemories({ projectId: activeProjectId ?? undefined, limit: 20 });
        setMemories(list.memories);
        setMemoryPreview(null);
      }
    },
    [activeProjectId, client],
  );

  const fetchProviderModels = useCallback(
    async (input: RuntimeFetchModelsInput): Promise<RuntimeAvailableModelsResponse> => client.fetchProviderModels(input),
    [client],
  );

  const clearCurrentThreadContext = useCallback(async () => {
    if (!currentThread) return null;
    const cleared = await client.clearThreadContext(currentThread.id);
    setCurrentThread(cleared);
    await reloadThreads();
    return cleared;
  }, [client, currentThread, reloadThreads]);

  const compactCurrentThreadContext = useCallback(async () => {
    if (!currentThread || contextCompacting) return null;
    setContextCompacting(true);
    try {
      // 手动压缩会立刻置本地 loading，最终状态仍以 runtime 返回的 thread 为准。
      const compacted = await client.compactThreadContext(currentThread.id);
      setCurrentThread(compacted);
      await reloadThreads();
      return compacted;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setCurrentThread((thread) => (
        thread?.contextCompaction?.status === 'running'
          ? { ...thread, contextCompaction: undefined }
          : thread
      ));
      return null;
    } finally {
      setContextCompacting(false);
    }
  }, [client, contextCompacting, currentThread, reloadThreads]);

  const selectProviderModel = useCallback(
    async (providerId: string, modelId: string) => {
      if (!config) return;
      const next = await client.saveConfig({
        activeProviderId: providerId,
        providers: config.providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          provider: provider.provider,
          baseUrl: provider.baseUrl,
          enabled: provider.id === providerId ? true : provider.enabled,
          models: provider.models.map((model) => ({
            ...model,
            enabled: provider.id === providerId ? model.id === modelId : model.enabled,
          })),
        })),
      });
      setConfig(next);
    },
    [client, config],
  );

  const updateSkill = useCallback(
    async (skill: RuntimeSkillSummary, patch: Partial<RuntimeSkillInput>): Promise<RuntimeSkillDetail> => {
      const updated = await client.updateSkill(skill.id, patch);
      setSkills((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      return updated;
    },
    [client],
  );

  const createSkill = useCallback(
    async (input: RuntimeSkillInput): Promise<RuntimeSkillDetail> => {
      const created = await client.createSkill(input);
      setSkills((items) => [...items.filter((item) => item.id !== created.id), created].sort((left, right) => left.name.localeCompare(right.name)));
      return created;
    },
    [client],
  );

  const getSkillDetail = useCallback(
    async (skillId: string): Promise<RuntimeSkillDetail> => client.getSkill(skillId),
    [client],
  );

  const deleteSkill = useCallback(
    async (skill: RuntimeSkillSummary): Promise<void> => {
      await client.deleteSkill(skill.id);
      setSkills((items) => items.filter((item) => item.id !== skill.id));
    },
    [client],
  );

  const saveMcpServer = useCallback(
    async (input: RuntimeMcpServerInput) => {
      const next = await client.upsertMcpServer(input);
      setMcpState(next);
    },
    [client],
  );

  const fetchMcpServerTools = useCallback(
    async (input: RuntimeMcpServerInput): Promise<RuntimeMcpToolList> => client.fetchMcpServerTools(input),
    [client],
  );

  const updateMcpServer = useCallback(
    async (server: RuntimeMcpServer, patch: Partial<Pick<RuntimeMcpServer, 'enabled' | 'required' | 'requireApproval'>>) => {
      const next = await client.updateMcpServer(server.key, patch);
      setMcpState(next);
    },
    [client],
  );

  const deleteMcpServer = useCallback(
    async (server: RuntimeMcpServer) => {
      await client.deleteMcpServer(server.key);
      const next = await client.listMcpServers();
      setMcpState(next);
    },
    [client],
  );

  const previewMemories = useCallback(async () => {
    setMemoryPreviewLoading(true);
    try {
      const preview = await client.previewMemories();
      setMemoryPreview(preview);
      return preview;
    } finally {
      setMemoryPreviewLoading(false);
    }
  }, [client]);

  const deleteMemory = useCallback(
    async (memoryId: string) => {
      await client.deleteMemory(memoryId);
      const list = await client.listMemories({ projectId: activeProjectId ?? undefined, limit: 20 });
      setMemories(list.memories);
      const preview = await client.previewMemories();
      setMemoryPreview(preview);
    },
    [activeProjectId, client],
  );

  const clearMemories = useCallback(async () => {
    const list = await client.clearMemories();
    setMemories(list.memories);
    const preview = await client.previewMemories();
    setMemoryPreview(preview);
  }, [client]);

  const answerApproval = useCallback(
    async (approvalId: string, input: { decision: 'approve' | 'reject'; message?: string }) => {
      await client.answerApproval(approvalId, input);
      const resolvedAt = new Date().toISOString();
      // 先乐观更新审批列表和当前线程 toolRun，再异步拉一次线程快照校正 seq。
      setApprovals((items) =>
        items.map((item) =>
          item.id === approvalId
            ? {
                ...item,
                status: input.decision === 'approve' ? 'approved' : 'rejected',
                message: input.message,
                resolvedAt,
              }
            : item,
        ),
      );
      setCurrentThread((thread) => updateThreadApprovalRun(thread, approvalId, input, resolvedAt));
      if (currentThreadId) {
        client
          .getThread(currentThreadId)
          .then((nextThread) => setCurrentThread((thread) => (thread?.id === currentThreadId && nextThread.lastSeq >= thread.lastSeq ? nextThread : thread)))
          .catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
      }
    },
    [client, currentThreadId],
  );

  return {
    activeTurnId: effectiveActiveTurnId,
    activityEvents,
    answerApproval,
    approvals,
    client,
    config,
    compactCurrentThreadContext,
    contextCompacting,
    clearCurrentThreadContext,
    clearMemories,
    createSkill,
    currentThread,
    deleteMcpServer,
    deleteMemory,
    deleteSkill,
    error,
    fetchProviderModels,
    fetchMcpServerTools,
    getSkillDetail,
    loadState,
    mcpState,
    memories,
    memoryPreview,
    memoryPreviewLoading,
    previewMemories,
    projects,
    refresh,
    reloadThreads,
    saveMcpServer,
    saveProviders,
    saveRuntimePreferences,
    selectProviderModel,
    setActiveTurnId,
    setCurrentThread,
    setError,
    setProjects,
    skills,
    terminalTurnIdsRef,
    threads,
    updateMcpServer,
    updateSkill,
    usage,
  };
}

/**
 * 在当前线程快照里乐观更新审批对应的 toolRun。
 *
 * @param thread 当前线程快照。
 * @param approvalId 被回复的 approval ID。
 * @param input 用户审批结果。
 * @param resolvedAt 本地记录的审批完成时间。
 */
function updateThreadApprovalRun(
  thread: RuntimeThread | null,
  approvalId: string,
  input: { decision: 'approve' | 'reject'; message?: string },
  resolvedAt: string,
): RuntimeThread | null {
  if (!thread) return thread;
  let changed = false;
  const messages = thread.messages.map((message) => {
    if (!message.toolRuns?.some((run) => run.approvalId === approvalId)) return message;
    changed = true;
    return {
      ...message,
      toolRuns: message.toolRuns.map((run) => {
        if (run.approvalId !== approvalId) return run;
        const nextRun: RuntimeToolRun = {
          ...run,
          approvalStatus: input.decision === 'approve' ? 'approved' : 'rejected',
          approvalMessage: input.message,
          status: input.decision === 'approve' ? 'running' : 'rejected',
          completedAt: input.decision === 'reject' ? resolvedAt : run.completedAt,
          resultPreview: input.decision === 'reject' ? input.message || 'Tool call rejected.' : run.resultPreview,
        };
        return nextRun;
      }),
    };
  });
  return changed ? { ...thread, updatedAt: resolvedAt, messages } : thread;
}

export type RuntimeClientState = ReturnType<typeof useRuntimeClientState>;

/**
 * 判断指定 turn 是否已经从 renderer 视角完成。
 *
 * @param thread 当前线程快照。
 * @param turnId 需要判断的 turn ID。
 */
export function turnHasFinished(thread: RuntimeThread, turnId: string): boolean {
  // 这里是 renderer 的兜底判断，不能依赖 turn.completed 事件一定到达。
  const turnMessages = thread.messages.filter((message) => message.turnId === turnId);
  if (!turnMessages.length) return false;
  if (turnMessages.some((message) => message.status === 'streaming')) return false;
  if (turnMessages.some((message) => message.toolRuns?.some(isActiveToolRun))) return false;
  const latestAssistant = turnMessages.findLast((message) => message.role === 'assistant');
  if (!latestAssistant) return false;
  if (latestAssistant.status === 'error' || latestAssistant.error) return true;
  return latestAssistant.status === 'complete' && !latestAssistant.toolCalls?.length;
}

/**
 * 从线程快照中反推仍在运行的 turn。
 *
 * @param thread 当前线程快照。
 * @param terminalTurnIds renderer 已确认终态的 turn ID 集合。
 */
export function inferActiveTurnIdFromThread(thread: RuntimeThread | null, terminalTurnIds: ReadonlySet<string>): string | null {
  if (!thread) return null;
  // 从后往前找可以优先命中最新还在 streaming 或工具运行中的 turn。
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (!message?.turnId || terminalTurnIds.has(message.turnId)) continue;
    if (message.status === 'streaming') return message.turnId;
    if (message.toolRuns?.some(isActiveToolRun)) return message.turnId;
  }
  return null;
}

function isActiveToolRun(run: NonNullable<RuntimeThread['messages'][number]['toolRuns']>[number]): boolean {
  return run.status === 'running' || (run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected');
}
