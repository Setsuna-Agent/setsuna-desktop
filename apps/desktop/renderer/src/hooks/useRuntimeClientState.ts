import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  AnswerRuntimeApprovalInput,
  ProviderConfigState,
  RuntimeAvailableModelsResponse,
  RuntimeApprovalRequest,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeEvent,
  RuntimeFetchModelsInput,
  RuntimeHookInput,
  RuntimeHookListResponse,
  RuntimeHookMetadata,
  RuntimeMemoryPreview,
  RuntimeMemoryRecord,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpToolList,
  RuntimeReviewTarget,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillSummary,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadSummary,
  RuntimeToolRun,
  RuntimeUsageResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { createDesktopRuntimeClient } from '../runtime/desktop-runtime-client.js';
import { deleteHookFromConfig, hookConfigLocation, hookInputToMatcherGroup, updateHookInConfig } from '../utils/runtimeHookConfig.js';
import { applyRuntimeEvent, isActivityEvent } from '../utils/runtimeEvents.js';

export type LoadState = 'loading' | 'ready' | 'error';
const lastActiveThreadStorageKey = 'setsuna-desktop:last-active-thread-id';

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
  const [archivedThreads, setArchivedThreads] = useState<RuntimeThreadSummary[]>([]);
  const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(null);
  const [config, setConfig] = useState<RuntimeConfigState | null>(null);
  const [contextCompacting, setContextCompacting] = useState(false);
  const [approvals, setApprovals] = useState<RuntimeApprovalRequest[]>([]);
  const [activityEvents, setActivityEvents] = useState<RuntimeEvent[]>([]);
  const [usage, setUsage] = useState<RuntimeUsageResponse | null>(null);
  const [threadUsage, setThreadUsage] = useState<RuntimeUsageResponse | null>(null);
  const [memories, setMemories] = useState<RuntimeMemoryRecord[]>([]);
  const [memoryPreview, setMemoryPreview] = useState<RuntimeMemoryPreview | null>(null);
  const [memoryPreviewLoading, setMemoryPreviewLoading] = useState(false);
  const [skills, setSkills] = useState<RuntimeSkillSummary[]>([]);
  const [skillExtraRoots, setSkillExtraRootsState] = useState<string[]>([]);
  const [mcpState, setMcpState] = useState<RuntimeMcpServerList | null>(null);
  const [hookState, setHookState] = useState<RuntimeHookListResponse | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [temporaryWorkspace, setTemporaryWorkspace] = useState<WorkspaceProject | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const initializedSelectionRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  // SSE 订阅从这个 seq 续接，组件重挂载时不会重复应用已处理事件。
  const currentThreadLastSeqRef = useRef(0);
  const threadListRefreshTimerRef = useRef<number | null>(null);
  // 终态 turn 记录在本地，避免延迟快照把已完成 turn 重新推断成 active。
  const terminalTurnIdsRef = useRef<Set<string>>(new Set());
  const currentThreadId = currentThread?.id ?? null;
  const effectiveActiveTurnId = activeTurnId ?? activeTurnIdFromThreadSnapshot(currentThread, terminalTurnIdsRef.current);
  const hasRunningThreadSummary = threads.some((thread) => Boolean(thread.activeTurnId))
    || archivedThreads.some((thread) => Boolean(thread.activeTurnId));
  const activeProject = activeProjectId ? projects.find((project) => project.id === activeProjectId) ?? null : null;
  const activeHookCwds = useMemo(() => (activeProject?.path ? [activeProject.path] : []), [activeProject?.path]);
  currentThreadLastSeqRef.current = currentThread?.lastSeq ?? 0;

  const refresh = useCallback(async () => {
    setError(null);
    // 首屏需要多个 runtime 域的数据；并行拉取能避免设置页/侧栏/对话区分批闪烁。
    const [nextConfig, threadList, allThreadList, skillList, mcpList, hookList, projectList, workspaceStatus, usageSummary, memoryList, approvalList] = await Promise.all([
      client.getConfig(),
      client.listThreads(),
      client.listThreads({ includeArchived: true }),
      client.listSkills(),
      client.listMcpServers(),
      client.listHooks(activeHookCwds),
      client.listProjects(),
      client.getWorkspaceStatus(),
      client.getUsage(),
      client.listMemories({ limit: 20 }),
      client.listApprovals(),
    ]);
    setConfig(nextConfig);
    setThreads(threadList.threads);
    setArchivedThreads(allThreadList.threads.filter((thread) => thread.archived));
    setSkills(skillList.skills);
    setMcpState(mcpList);
    setHookState(hookList);
    setProjects(projectList.projects);
    setTemporaryWorkspace(workspaceStatus.project ?? null);
    setUsage(usageSummary);
    setMemories(memoryList.memories);
    setApprovals(approvalList.approvals);

    if (!initializedSelectionRef.current) {
      initializedSelectionRef.current = true;
      const initialThread = selectInitialThreadSummary(threadList.threads, readPersistedActiveThreadId());
      if (initialThread) {
        const thread = await client.getThread(initialThread.id);
        setCurrentThread(thread);
        setActiveProjectId(thread.projectId ?? null);
      } else {
        setActiveProjectId((current) => current ?? projectList.projects[0]?.id ?? null);
      }
    }

    setLoadState('ready');
  }, [activeHookCwds, client, setActiveProjectId]);

  useEffect(() => {
    if (currentThreadId) persistActiveThreadId(currentThreadId);
  }, [currentThreadId]);

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

  useEffect(() => {
    if (!effectiveActiveTurnId && !hasRunningThreadSummary) return undefined;
    let cancelled = false;
    let timeoutId: number | undefined;
    const pollThreadSummaries = async () => {
      try {
        const [visible, all] = await Promise.all([
          client.listThreads(),
          client.listThreads({ includeArchived: true }),
        ]);
        if (cancelled) return;
        setThreads(visible.threads);
        setArchivedThreads(all.threads.filter((thread) => thread.archived));
        const stillRunning = visible.threads.some((thread) => Boolean(thread.activeTurnId))
          || all.threads.some((thread) => Boolean(thread.activeTurnId));
        if (stillRunning || effectiveActiveTurnId) timeoutId = window.setTimeout(pollThreadSummaries, 1000);
      } catch (unknownError) {
        if (!cancelled) {
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
          timeoutId = window.setTimeout(pollThreadSummaries, 1000);
        }
      }
    };
    timeoutId = window.setTimeout(pollThreadSummaries, 250);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [client, effectiveActiveTurnId, hasRunningThreadSummary]);

  const refreshCapabilities = useCallback(() => {
    void Promise.all([client.listSkills(), client.listMcpServers(), client.listHooks(activeHookCwds)])
      .then(([skillList, mcpList, hookList]) => {
        setSkills(skillList.skills);
        setMcpState(mcpList);
        setHookState(hookList);
      })
      .catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
  }, [activeHookCwds, client]);

  const refreshHooks = useCallback(async () => {
    const hookList = await client.listHooks(activeHookCwds);
    setHookState(hookList);
    return hookList;
  }, [activeHookCwds, client]);

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
        if (event.payload.usage) void client.getUsage({ threadId: event.threadId }).then(setThreadUsage);
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
                  status: event.payload.decision === 'reject' || event.payload.decision === 'cancel' ? 'rejected' : 'approved',
                  decision: event.payload.decision,
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
    const recoveringActiveGoal = currentThread?.goal?.status === 'active';
    if ((!effectiveActiveTurnId && !recoveringActiveGoal) || !currentThreadId) return undefined;
    let cancelled = false;
    let timeoutId: number | undefined;
    const threadId = currentThreadId;
    const turnId = effectiveActiveTurnId;

    // polling 校正线程快照和 activeTurnId；runtime 快照里的 activeTurnId 是终态兜底真源。
    const pollThread = async () => {
      let continuePolling = true;
      try {
        const nextThread = await client.getThread(threadId);
        if (cancelled) return;
        setCurrentThread((thread) => (thread?.id === threadId && nextThread.lastSeq >= thread.lastSeq ? nextThread : thread));
        refreshThreadsSoon();
        const snapshotActiveTurnId = activeTurnIdFromThreadSnapshot(nextThread, terminalTurnIdsRef.current);
        if (!turnId) {
          if (snapshotActiveTurnId) {
            terminalTurnIdsRef.current.delete(snapshotActiveTurnId);
            setActiveTurnId(snapshotActiveTurnId);
          } else {
            continuePolling = nextThread.goal?.status === 'active';
          }
        } else if (!snapshotActiveTurnId) {
          terminalTurnIdsRef.current.add(turnId);
          setActiveTurnId((current) => (current === turnId ? null : current));
          refreshCapabilities();
          void client.getUsage().then(setUsage);
          continuePolling = nextThread.goal?.status === 'active';
        } else if (snapshotActiveTurnId !== turnId) {
          terminalTurnIdsRef.current.delete(snapshotActiveTurnId);
          setActiveTurnId(snapshotActiveTurnId);
        }
      } catch (unknownError) {
        if (!cancelled) setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
      if (!cancelled && continuePolling) timeoutId = window.setTimeout(pollThread, 1000);
    };

    timeoutId = window.setTimeout(pollThread, 250);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [effectiveActiveTurnId, client, currentThread?.goal?.status, currentThreadId, refreshCapabilities, refreshThreadsSoon]);

  useEffect(() => {
    client
      .listMemories({ projectId: activeProjectId ?? undefined, limit: 20 })
      .then((result) => setMemories(result.memories))
      .catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
  }, [activeProjectId, client]);

  useEffect(() => {
    if (!currentThreadId) {
      setThreadUsage(null);
      return;
    }
    client
      .getUsage({ threadId: currentThreadId })
      .then(setThreadUsage)
      .catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
  }, [client, currentThreadId]);

  useEffect(() => {
    refreshHooks().catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
  }, [refreshHooks]);

  const reloadThreads = useCallback(async () => {
    const [list, allList] = await Promise.all([
      client.listThreads(),
      client.listThreads({ includeArchived: true }),
    ]);
    setThreads(list.threads);
    setArchivedThreads(allList.threads.filter((thread) => thread.archived));
    return list.threads;
  }, [client]);

  const saveProviders = useCallback(
    async (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => {
      const activeProviderId = providers.some((provider) => provider.id === config?.activeProviderId && provider.enabled)
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
    async (input: Pick<RuntimeConfigInput, 'globalPrompt' | 'storagePath' | 'memory' | 'memoryEnabled' | 'setsunaStyle' | 'approvalPolicy' | 'permissionProfile' | 'sandboxWorkspaceWrite' | 'bypassHookTrust' | 'features'>) => {
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
      setCurrentThread((thread) => (
        !thread || thread.id !== compacted.id || compacted.lastSeq >= thread.lastSeq
          ? compacted
          : thread
      ));
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

  const updateCurrentThreadMemoryMode = useCallback(
    async (mode: RuntimeThreadMemoryMode) => {
      if (!currentThread) return null;
      const updated = await client.updateThreadMemoryMode(currentThread.id, { mode });
      setCurrentThread(updated);
      await reloadThreads();
      return updated;
    },
    [client, currentThread, reloadThreads],
  );

  const clearCurrentThreadGoal = useCallback(async () => {
    if (!currentThread) return false;
    const cleared = await client.clearThreadGoal(currentThread.id);
    if (cleared) setCurrentThread((thread) => {
      if (thread?.id !== currentThread.id) return thread;
      const next = { ...thread };
      delete next.goal;
      return next;
    });
    await reloadThreads();
    return cleared;
  }, [client, currentThread, reloadThreads]);

  const restoreArchivedThread = useCallback(async (threadId: string) => {
    const restored = await client.updateThread(threadId, { archived: false });
    await reloadThreads();
    return restored;
  }, [client, reloadThreads]);

  const permanentlyDeleteThread = useCallback(async (threadId: string) => {
    await client.deleteThread(threadId);
    await reloadThreads();
  }, [client, reloadThreads]);

  const permanentlyDeleteArchivedThreads = useCallback(async (threadIds: string[]) => {
    const uniqueThreadIds = [...new Set(threadIds)];
    if (!uniqueThreadIds.length) return;

    const results = await Promise.allSettled(uniqueThreadIds.map((threadId) => client.deleteThread(threadId)));
    await reloadThreads();

    const failureCount = results.filter((result) => result.status === 'rejected').length;
    if (failureCount) throw new Error(`${failureCount} 个归档对话删除失败，请重试。`);
  }, [client, reloadThreads]);

  const startCurrentThreadReview = useCallback(async (target: RuntimeReviewTarget) => {
    if (!currentThread) return null;
    const started = await client.startReview(currentThread.id, target);
    setActiveTurnId(started.turnId);
    return started;
  }, [client, currentThread]);

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

  const setSkillExtraRoots = useCallback(async (roots: string[]) => {
    const normalizedRoots = [...new Set(roots.map((root) => root.trim()).filter(Boolean))];
    await client.setSkillExtraRoots(normalizedRoots);
    const skillList = await client.listSkills();
    setSkillExtraRootsState(normalizedRoots);
    setSkills(skillList.skills);
  }, [client]);

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

  const updateHookState = useCallback(
    async (hook: RuntimeHookMetadata, patch: { enabled?: boolean; trustedHash?: string }) => {
      if (!config) return;
      const currentHooks = config.hooks ?? {};
      const currentState = currentHooks.state ?? {};
      const currentHookState = currentState[hook.key] ?? {};
      const next = await client.saveConfig({
        hooks: {
          ...currentHooks,
          state: {
            ...currentState,
            [hook.key]: {
              ...currentHookState,
              ...patch,
            },
          },
        },
      });
      setConfig(next);
      await refreshHooks();
    },
    [client, config, refreshHooks],
  );

  const trustHook = useCallback(
    async (hook: RuntimeHookMetadata) => updateHookState(hook, { trustedHash: hook.currentHash }),
    [updateHookState],
  );

  const updateHookEnabled = useCallback(
    async (hook: RuntimeHookMetadata, enabled: boolean) => updateHookState(hook, { enabled }),
    [updateHookState],
  );

  const createHook = useCallback(
    async (input: RuntimeHookInput) => {
      if (!config) throw new Error('Runtime config is not loaded.');
      const command = input.command.trim();
      if (!command) throw new Error('Hook command is required.');
      const currentHooks = config.hooks ?? {};
      const groups = currentHooks[input.eventName] ?? [];
      const next = await client.saveConfig({
        hooks: {
          ...currentHooks,
          [input.eventName]: [
            ...groups,
            hookInputToMatcherGroup({ ...input, command }),
          ],
        },
      });
      setConfig(next);
      await refreshHooks();
    },
    [client, config, refreshHooks],
  );

  const updateHook = useCallback(
    async (hook: RuntimeHookMetadata, input: RuntimeHookInput) => {
      if (!config) throw new Error('Runtime config is not loaded.');
      const command = input.command.trim();
      if (!command) throw new Error('Hook command is required.');
      const currentHooks = config.hooks ?? {};
      const location = hookConfigLocation(hook);
      if (!location) throw new Error('Hook location is invalid.');
      const nextHooks = updateHookInConfig(currentHooks, location, { ...input, command });
      const next = await client.saveConfig({ hooks: nextHooks });
      setConfig(next);
      await refreshHooks();
    },
    [client, config, refreshHooks],
  );

  const deleteHook = useCallback(
    async (hook: RuntimeHookMetadata) => {
      if (!config) throw new Error('Runtime config is not loaded.');
      const currentHooks = config.hooks ?? {};
      const location = hookConfigLocation(hook);
      if (!location) throw new Error('Hook location is invalid.');
      const nextHooks = deleteHookFromConfig(currentHooks, location);
      const next = await client.saveConfig({ hooks: nextHooks });
      setConfig(next);
      await refreshHooks();
    },
    [client, config, refreshHooks],
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
    async (approvalId: string, input: AnswerRuntimeApprovalInput) => {
      await client.answerApproval(approvalId, input);
      const resolvedAt = new Date().toISOString();
      // 先乐观更新审批列表和当前线程 toolRun，再异步拉一次线程快照校正 seq。
      setApprovals((items) =>
        items.map((item) =>
          item.id === approvalId
            ? {
                ...item,
                status: input.decision === 'reject' || input.decision === 'cancel' ? 'rejected' : 'approved',
                decision: input.decision,
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
    archivedThreads,
    activityEvents,
    answerApproval,
    approvals,
    client,
    config,
    compactCurrentThreadContext,
    contextCompacting,
    clearCurrentThreadContext,
    clearCurrentThreadGoal,
    clearMemories,
    createHook,
    createSkill,
    currentThread,
    deleteHook,
    deleteMcpServer,
    deleteMemory,
    deleteSkill,
    error,
    fetchProviderModels,
    fetchMcpServerTools,
    getSkillDetail,
    hookState,
    loadState,
    mcpState,
    memories,
    memoryPreview,
    memoryPreviewLoading,
    previewMemories,
    projects,
    refresh,
    refreshHooks,
    reloadThreads,
    permanentlyDeleteArchivedThreads,
    permanentlyDeleteThread,
    restoreArchivedThread,
    saveMcpServer,
    saveProviders,
    saveRuntimePreferences,
    selectProviderModel,
    setActiveTurnId,
    setCurrentThread,
    setError,
    setProjects,
    setSkillExtraRoots,
    skillExtraRoots,
    skills,
    temporaryWorkspace,
    terminalTurnIdsRef,
    threadUsage,
    threads,
    updateCurrentThreadMemoryMode,
    updateMcpServer,
    trustHook,
    updateHook,
    updateHookEnabled,
    updateSkill,
    usage,
    startCurrentThreadReview,
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
  input: AnswerRuntimeApprovalInput,
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
        const rejected = input.decision === 'reject' || input.decision === 'cancel';
        const nextRun: RuntimeToolRun = {
          ...run,
          approvalStatus: rejected ? 'rejected' : 'approved',
          approvalMessage: input.message,
          status: rejected ? 'rejected' : 'running',
          completedAt: rejected ? resolvedAt : run.completedAt,
          resultPreview: rejected ? input.message || 'Tool call rejected.' : run.resultPreview,
        };
        return nextRun;
      }),
    };
  });
  return changed ? { ...thread, updatedAt: resolvedAt, messages } : thread;
}

export type RuntimeClientState = ReturnType<typeof useRuntimeClientState>;

export function selectInitialThreadSummary(
  threads: RuntimeThreadSummary[],
  persistedThreadId: string | null,
): RuntimeThreadSummary | undefined {
  if (persistedThreadId) {
    const persistedThread = threads.find((thread) => thread.id === persistedThreadId);
    if (persistedThread) return persistedThread;
  }
  return threads.find((thread) => !thread.projectId) ?? threads[0];
}

function readPersistedActiveThreadId(): string | null {
  const storage = browserLocalStorage();
  if (!storage) return null;
  try {
    return normalizeStoredThreadId(storage.getItem(lastActiveThreadStorageKey));
  } catch {
    return null;
  }
}

function persistActiveThreadId(threadId: string): void {
  const storage = browserLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(lastActiveThreadStorageKey, threadId);
  } catch {
    // localStorage can be unavailable in restricted renderer contexts; runtime fallback still works.
  }
}

function normalizeStoredThreadId(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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

export function activeTurnIdFromThreadSnapshot(thread: RuntimeThread | null, terminalTurnIds: ReadonlySet<string>): string | null {
  if (!thread) return null;
  // runtime 快照里的 activeTurnId 是真源；消息状态推断只作为旧快照/事件丢失时的兜底。
  if (thread.activeTurnId && !terminalTurnIds.has(thread.activeTurnId)) return thread.activeTurnId;
  return inferActiveTurnIdFromThread(thread, terminalTurnIds);
}

function isActiveToolRun(run: NonNullable<RuntimeThread['messages'][number]['toolRuns']>[number]): boolean {
  return run.status === 'running' || (run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected');
}
