import type {
  AnswerRuntimeApprovalInput,
  DesktopRuntimeClient,
  ProviderConfigState,
  RuntimeApprovalStatus,
  RuntimeAvailableModelsResponse,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeEvent,
  RuntimeFetchModelsInput,
  RuntimeHookInput,
  RuntimeHookListResponse,
  RuntimeHookMetadata,
  RuntimeImageGenerationConfigInput,
  RuntimeImageGenerationTestInput,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpToolList,
  RuntimeMemoryPreview,
  RuntimeMemoryRecord,
  RuntimePluginInstallResult,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginMarketplaceItem,
  RuntimePluginSummary,
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
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  deleteHookFromConfig,
  hookConfigLocation,
  hookInputToMatcherGroup,
  updateHookInConfig,
} from '../../features/capabilities/hooks/runtimeHookConfig.js';
import { startThreadReview } from '../../features/workspace/hooks/startThreadReview.js';
import { useIdentityRequestGuard } from '../../shared/hooks/useIdentityRequestGuard.js';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';
import { createDesktopRuntimeClient } from './client.js';
import { applyRuntimeEvent, isActivityEvent } from './runtimeEvents.js';

export type LoadState = 'loading' | 'ready' | 'error';
const lastActiveThreadStorageKey = 'setsuna-desktop:last-active-thread-id';

export function isThreadContextCompacting(compactingThreadId: string | null, threadId: string | null): boolean {
  return compactingThreadId !== null && compactingThreadId === threadId;
}

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
  const [contextCompactingThreadId, setContextCompactingThreadId] = useState<string | null>(null);
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
  const [plugins, setPlugins] = useState<RuntimePluginSummary[]>([]);
  const [pluginMarketplace, setPluginMarketplace] = useState<RuntimePluginMarketplaceItem[]>([]);
  const [pluginMarketplaceErrors, setPluginMarketplaceErrors] = useState<string[]>([]);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const initializedSelectionRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  // SSE 订阅从这个 seq 续接，组件重挂载时不会重复应用已处理事件。
  const currentThreadLastSeqRef = useRef(0);
  const threadListRefreshTimerRef = useRef<number | null>(null);
  // 终态 turn 记录在本地，避免延迟快照把已完成 turn 重新推断成 active。
  const terminalTurnIdsRef = useRef<Set<string>>(new Set());
  const hookRequests = useLatestRequestGuard();
  const memoryListRequests = useLatestRequestGuard();
  const memoryPreviewRequests = useLatestRequestGuard();
  const threadMemoryModeRequests = useLatestRequestGuard();
  const currentThreadId = currentThread?.id ?? null;
  const contextRequests = useIdentityRequestGuard(currentThreadId ?? 'no-current-thread');
  const currentThreadIdRef = useRef(currentThreadId);
  const activeProjectIdRef = useRef(activeProjectId);
  currentThreadIdRef.current = currentThreadId;
  activeProjectIdRef.current = activeProjectId;
  const contextCompacting = isThreadContextCompacting(contextCompactingThreadId, currentThreadId);
  const effectiveActiveTurnId = activeTurnId ?? activeTurnIdFromThreadSnapshot(currentThread, terminalTurnIdsRef.current);
  const hasRunningThreadSummary = threads.some((thread) => Boolean(thread.activeTurnId))
    || archivedThreads.some((thread) => Boolean(thread.activeTurnId));
  const activeProject = activeProjectId ? projects.find((project) => project.id === activeProjectId) ?? null : null;
  const activeHookCwds = useMemo(() => (activeProject?.path ? [activeProject.path] : []), [activeProject?.path]);
  currentThreadLastSeqRef.current = currentThread?.lastSeq ?? 0;

  const refresh = useCallback(async () => {
    setLoadState('loading');
    setError(null);
    try {
      // 只有进入工作台必需的状态失败才是致命错误；可选功能域各自独立降级。
      const bootstrap = await loadRuntimeBootstrap(client);
      const { nextConfig, threadList, allThreadList, projectList } = bootstrap.core;
      const { skillResult, mcpResult, pluginResult, pluginMarketplaceResult, usageResult } = bootstrap.optional;
      setConfig(nextConfig);
      setThreads(threadList.threads);
      setArchivedThreads(allThreadList.threads.filter((thread) => thread.archived));
      setProjects(projectList.projects);
      if (skillResult.status === 'fulfilled') setSkills(skillResult.value.skills);
      if (mcpResult.status === 'fulfilled') setMcpState(mcpResult.value);
      if (pluginResult.status === 'fulfilled') setPlugins(pluginResult.value.plugins);
      if (pluginMarketplaceResult.status === 'fulfilled') {
        setPluginMarketplace(pluginMarketplaceResult.value.plugins);
        setPluginMarketplaceErrors(pluginMarketplaceResult.value.errors);
      }
      if (usageResult.status === 'fulfilled') setUsage(usageResult.value);
      reportOptionalLoadFailures([
        ['skills', skillResult],
        ['MCP', mcpResult],
        ['plugins', pluginResult],
        ['plugin marketplace', pluginMarketplaceResult],
        ['usage', usageResult],
      ]);

      if (!initializedSelectionRef.current) {
        initializedSelectionRef.current = true;
        const initialThread = selectInitialThreadSummary(threadList.threads, readPersistedActiveThreadId());
        if (initialThread) {
          try {
            const thread = await client.getThread(initialThread.id);
            setCurrentThread(thread);
            setActiveProjectId(thread.projectId ?? null);
          } catch (unknownError) {
            console.warn('[runtime] failed to restore the last active thread', unknownError);
            setCurrentThread(null);
            setActiveProjectId((current) => current ?? projectList.projects[0]?.id ?? null);
          }
        } else {
          setActiveProjectId((current) => current ?? projectList.projects[0]?.id ?? null);
        }
      }

      setLoadState('ready');
    } catch (unknownError) {
      setLoadState('error');
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      throw unknownError;
    }
  }, [client, setActiveProjectId]);

  useEffect(() => {
    if (currentThreadId) persistActiveThreadId(currentThreadId);
  }, [currentThreadId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
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

  const refreshCapabilities = useCallback(async () => {
    const isLatestHookRequest = hookRequests.begin();
    const results = await Promise.allSettled([
      client.listSkills(),
      client.listMcpServers(),
      client.listHooks(activeHookCwds),
      client.listPlugins(),
      client.listPluginMarketplace(),
    ]);
    const [skillResult, mcpResult, hookResult, pluginResult, pluginMarketplaceResult] = results;
    if (isLatestHookRequest()) {
      if (skillResult.status === 'fulfilled') setSkills(skillResult.value.skills);
      if (mcpResult.status === 'fulfilled') setMcpState(mcpResult.value);
      if (hookResult.status === 'fulfilled') setHookState(hookResult.value);
      if (pluginResult.status === 'fulfilled') setPlugins(pluginResult.value.plugins);
      if (pluginMarketplaceResult.status === 'fulfilled') {
        setPluginMarketplace(pluginMarketplaceResult.value.plugins);
        setPluginMarketplaceErrors(pluginMarketplaceResult.value.errors);
      }
    }
    reportOptionalLoadFailures([
      ['skills', skillResult],
      ['MCP', mcpResult],
      ['hooks', hookResult],
      ['plugins', pluginResult],
      ['plugin marketplace', pluginMarketplaceResult],
    ]);
    const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (firstFailure && results.every((result) => result.status === 'rejected')) throw firstFailure.reason;
  }, [activeHookCwds, client, hookRequests]);

  const refreshHooks = useCallback(async () => {
    const isLatest = hookRequests.begin();
    const hookList = await client.listHooks(activeHookCwds);
    if (isLatest()) setHookState(hookList);
    return hookList;
  }, [activeHookCwds, client, hookRequests]);

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
        void refreshCapabilities().catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
        if (event.payload.usage) void client.getUsage().then(setUsage);
        if (event.payload.usage) {
          void client.getUsage({ threadId: event.threadId }).then((nextUsage) => {
            if (currentThreadIdRef.current === event.threadId) setThreadUsage(nextUsage);
          });
        }
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
          void refreshCapabilities().catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
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
    if (loadState !== 'ready') return undefined;
    const projectId = activeProjectId;
    const isLatest = memoryListRequests.begin();
    setMemories([]);
    void client
      .listMemories({ projectId: projectId ?? undefined, limit: 20 })
      .then((result) => {
        if (isLatest() && activeProjectIdRef.current === projectId) setMemories(result.memories);
      })
      .catch((unknownError) => {
        if (isLatest()) setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
    return () => memoryListRequests.invalidate();
  }, [activeProjectId, client, loadState, memoryListRequests]);

  useEffect(() => {
    if (!currentThreadId) {
      setThreadUsage(null);
      return undefined;
    }
    const threadId = currentThreadId;
    let cancelled = false;
    setThreadUsage(null);
    void client
      .getUsage({ threadId: currentThreadId })
      .then((nextUsage) => {
        if (!cancelled && currentThreadIdRef.current === threadId) setThreadUsage(nextUsage);
      })
      .catch((unknownError) => {
        if (!cancelled) setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
    return () => {
      cancelled = true;
    };
  }, [client, currentThreadId]);

  useEffect(() => {
    if (loadState !== 'ready') return;
    void refreshHooks().catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
  }, [loadState, refreshHooks]);

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
          icon: provider.icon ?? null,
          apiKey: apiKeysByProviderId[provider.id] || undefined,
          models: provider.models,
        })),
      });
      setConfig(next);
    },
    [client, config?.activeProviderId],
  );

  const saveImageGenerationConfig = useCallback(async (input: RuntimeImageGenerationConfigInput) => {
    const next = await client.saveConfig({ imageGeneration: input });
    setConfig(next);
  }, [client]);

  const testImageGeneration = useCallback(async (input: RuntimeImageGenerationTestInput) => {
    return await client.testImageGeneration(input);
  }, [client]);

  const saveRuntimePreferences = useCallback(
    async (input: Pick<RuntimeConfigInput, 'globalPrompt' | 'storagePath' | 'memory' | 'memoryEnabled' | 'setsunaStyle' | 'approvalPolicy' | 'permissionProfile' | 'sandboxWorkspaceWrite' | 'bypassHookTrust' | 'features' | 'desktopSettings'>) => {
      const next = await client.saveConfig(input);
      setConfig(next);
      if (Object.hasOwn(input, 'storagePath')) {
        const projectId = activeProjectId;
        const isLatest = memoryListRequests.begin();
        memoryPreviewRequests.invalidate();
        const list = await client.listMemories({ projectId: projectId ?? undefined, limit: 20 });
        if (isLatest() && activeProjectIdRef.current === projectId) {
          setMemories(list.memories);
          setMemoryPreview(null);
        }
      }
    },
    [activeProjectId, client, memoryListRequests, memoryPreviewRequests],
  );

  const fetchProviderModels = useCallback(
    async (input: RuntimeFetchModelsInput): Promise<RuntimeAvailableModelsResponse> => client.fetchProviderModels(input),
    [client],
  );

  const clearCurrentThreadContext = useCallback(async () => {
    if (!currentThread) return null;
    const isCurrentRequest = contextRequests.begin();
    const cleared = await client.clearThreadContext(currentThread.id);
    if (isCurrentRequest()) setCurrentThread(cleared);
    await reloadThreads();
    return cleared;
  }, [client, contextRequests, currentThread, reloadThreads]);

  const compactCurrentThreadContext = useCallback(async () => {
    if (!currentThread || contextCompacting) return null;
    const requestedThreadId = currentThread.id;
    const isCurrentRequest = contextRequests.begin();
    setContextCompactingThreadId(requestedThreadId);
    try {
      // 手动压缩会立刻置本地 loading，最终状态仍以 runtime 返回的 thread 为准。
      const compacted = await client.compactThreadContext(requestedThreadId);
      if (isCurrentRequest()) {
        setCurrentThread((thread) => (
          thread?.id === compacted.id && compacted.lastSeq >= thread.lastSeq
            ? compacted
            : thread
        ));
      }
      await reloadThreads();
      return compacted;
    } catch (unknownError) {
      if (isCurrentRequest()) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        setCurrentThread((thread) => (
          thread?.id === requestedThreadId && thread.contextCompaction?.status === 'running'
            ? { ...thread, contextCompaction: undefined }
            : thread
        ));
      }
      return null;
    } finally {
      setContextCompactingThreadId((current) => current === requestedThreadId ? null : current);
    }
  }, [client, contextCompacting, contextRequests, currentThread, reloadThreads]);

  const updateCurrentThreadMemoryMode = useCallback(
    async (mode: RuntimeThreadMemoryMode) => {
      if (!currentThread) return null;
      const threadId = currentThread.id;
      const isLatest = threadMemoryModeRequests.begin();
      const updated = await client.updateThreadMemoryMode(threadId, { mode });
      if (isLatest() && currentThreadIdRef.current === threadId) {
        setCurrentThread((thread) => (
          thread?.id === threadId && updated.lastSeq >= thread.lastSeq ? updated : thread
        ));
      }
      await reloadThreads();
      return updated;
    },
    [client, currentThread, reloadThreads, threadMemoryModeRequests],
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

  const startCurrentThreadReview = useCallback(async (
    target: RuntimeReviewTarget,
    scope?: {
      claimComposerForThread: (threadId: string) => void;
      isCurrentRequest: () => boolean;
    },
  ) => {
    const isCurrentRequest = scope?.isCurrentRequest ?? (() => true);
    const started = await startThreadReview({
      activeProjectId,
      client,
      currentThread,
      onThreadCreated: async (thread) => {
        if (isCurrentRequest()) {
          scope?.claimComposerForThread(thread.id);
          setCurrentThread(thread);
        }
        await reloadThreads();
      },
      target,
    });
    if (isCurrentRequest()) setActiveTurnId(started.turnId);
    return started;
  }, [activeProjectId, client, currentThread, reloadThreads]);

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
          icon: provider.icon ?? null,
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

  const installSkillMcpDependencies = useCallback(async (skill: RuntimeSkillSummary): Promise<RuntimeSkillDetail> => {
    const result = await client.installSkillMcpDependencies(skill.id);
    const [skillList, nextMcpState] = await Promise.all([client.listSkills(), client.listMcpServers()]);
    setSkills(skillList.skills);
    setMcpState(nextMcpState);
    return result.skill;
  }, [client]);

  const authenticateSkillMcpDependency = useCallback(async (
    skill: RuntimeSkillSummary,
    serverKey: string,
  ): Promise<RuntimeSkillDetail> => {
    const updated = await client.authenticateSkillMcpDependency(skill.id, serverKey);
    const [skillList, nextMcpState] = await Promise.all([client.listSkills(), client.listMcpServers()]);
    setSkills(skillList.skills);
    setMcpState(nextMcpState);
    return updated;
  }, [client]);

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

  const loginMcpServer = useCallback(async (server: RuntimeMcpServer) => {
    setMcpState(await client.loginMcpServer(server.key));
  }, [client]);

  const logoutMcpServer = useCallback(async (server: RuntimeMcpServer) => {
    setMcpState(await client.logoutMcpServer(server.key));
  }, [client]);

  const refreshPluginCapabilities = useCallback(async () => {
    const [pluginList, marketplace, skillList, nextMcpState, nextConfig, nextHookState] = await Promise.all([
      client.listPlugins(),
      client.listPluginMarketplace(),
      client.listSkills(),
      client.listMcpServers(),
      client.getConfig(),
      client.listHooks(activeHookCwds),
    ]);
    setPlugins(pluginList.plugins);
    setPluginMarketplace(marketplace.plugins);
    setPluginMarketplaceErrors(marketplace.errors);
    setSkills(skillList.skills);
    setMcpState(nextMcpState);
    setConfig(nextConfig);
    setHookState(nextHookState);
  }, [activeHookCwds, client]);

  const getPluginItemContent = useCallback((
    pluginId: string,
    kind: RuntimePluginItemKind,
    itemId: string,
    source: 'installed' | 'marketplace',
  ): Promise<RuntimePluginItemContent> => (
    source === 'installed'
      ? client.getPluginItemContent(pluginId, kind, itemId)
      : client.getMarketplacePluginItemContent(pluginId, kind, itemId)
  ), [client]);

  const installMarketplacePlugin = useCallback(async (pluginId: string): Promise<RuntimePluginInstallResult> => {
    const result = await client.installMarketplacePlugin(pluginId);
    await refreshPluginCapabilities();
    return result;
  }, [client, refreshPluginCapabilities]);

  const updateMarketplacePlugin = useCallback(async (pluginId: string): Promise<RuntimePluginInstallResult> => {
    const result = await client.updateMarketplacePlugin(pluginId);
    await refreshPluginCapabilities();
    return result;
  }, [client, refreshPluginCapabilities]);

  const removePlugin = useCallback(async (pluginId: string): Promise<void> => {
    await client.removePlugin(pluginId);
    await refreshPluginCapabilities();
  }, [client, refreshPluginCapabilities]);

  const previewMemories = useCallback(async () => {
    const isLatest = memoryPreviewRequests.begin();
    setMemoryPreviewLoading(true);
    try {
      const preview = await client.previewMemories();
      if (isLatest()) setMemoryPreview(preview);
      return preview;
    } finally {
      if (isLatest()) setMemoryPreviewLoading(false);
    }
  }, [client, memoryPreviewRequests]);

  const deleteMemory = useCallback(
    async (memoryId: string) => {
      const projectId = activeProjectId;
      const isLatest = memoryListRequests.begin();
      const isLatestPreview = memoryPreviewRequests.begin();
      await client.deleteMemory(memoryId);
      const [list, preview] = await Promise.all([
        client.listMemories({ projectId: projectId ?? undefined, limit: 20 }),
        client.previewMemories(),
      ]);
      if (isLatest() && activeProjectIdRef.current === projectId) setMemories(list.memories);
      if (isLatestPreview()) setMemoryPreview(preview);
    },
    [activeProjectId, client, memoryListRequests, memoryPreviewRequests],
  );

  const clearMemories = useCallback(async () => {
    const projectId = activeProjectId;
    const isLatest = memoryListRequests.begin();
    const isLatestPreview = memoryPreviewRequests.begin();
    const list = await client.clearMemories();
    const preview = await client.previewMemories();
    if (isLatest() && activeProjectIdRef.current === projectId) setMemories(list.memories);
    if (isLatestPreview()) setMemoryPreview(preview);
  }, [activeProjectId, client, memoryListRequests, memoryPreviewRequests]);

  const answerApproval = useCallback(
    async (approvalId: string, input: AnswerRuntimeApprovalInput) => {
      await client.answerApproval(approvalId, input);
      const resolvedAt = new Date().toISOString();
      // 先乐观更新当前线程 toolRun，再异步拉一次线程快照校正 seq。
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
    authenticateSkillMcpDependency,
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
    getPluginItemContent,
    getSkillDetail,
    hookState,
    loadState,
    loginMcpServer,
    installMarketplacePlugin,
    updateMarketplacePlugin,
    installSkillMcpDependencies,
    mcpState,
    memories,
    memoryPreview,
    memoryPreviewLoading,
    previewMemories,
    logoutMcpServer,
    projects,
    plugins,
    pluginMarketplace,
    pluginMarketplaceErrors,
    refresh,
    refreshCapabilities,
    refreshHooks,
    reloadThreads,
    permanentlyDeleteArchivedThreads,
    permanentlyDeleteThread,
    restoreArchivedThread,
    removePlugin,
    saveMcpServer,
    saveImageGenerationConfig,
    testImageGeneration,
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
        const approvalStatus = approvalStatusForDecision(input.decision);
        const terminal = approvalStatus === 'rejected' || approvalStatus === 'cancelled';
        const nextRun: RuntimeToolRun = {
          ...run,
          approvalStatus,
          approvalMessage: input.message,
          status: terminal ? approvalStatus : 'running',
          completedAt: terminal ? resolvedAt : run.completedAt,
          resultPreview: terminal
            ? input.message || (approvalStatus === 'cancelled' ? 'Tool call cancelled.' : 'Tool call rejected.')
            : run.resultPreview,
        };
        return nextRun;
      }),
    };
  });
  return changed ? { ...thread, updatedAt: resolvedAt, messages } : thread;
}

export type RuntimeClientState = ReturnType<typeof useRuntimeClientState>;

type RuntimeBootstrapClient = Pick<
  DesktopRuntimeClient,
  'getConfig' | 'getUsage' | 'listMcpServers' | 'listPluginMarketplace' | 'listPlugins' | 'listProjects' | 'listSkills' | 'listThreads'
>;

export async function loadRuntimeBootstrap(client: RuntimeBootstrapClient) {
  const [core, optional] = await Promise.all([
    Promise.all([
      client.getConfig(),
      client.listThreads(),
      client.listThreads({ includeArchived: true }),
      client.listProjects(),
    ]),
    Promise.allSettled([
      client.listSkills(),
      client.listMcpServers(),
      client.listPlugins(),
      client.listPluginMarketplace(),
      client.getUsage(),
    ]),
  ]);
  const [nextConfig, threadList, allThreadList, projectList] = core;
  const [skillResult, mcpResult, pluginResult, pluginMarketplaceResult, usageResult] = optional;
  return {
    core: { nextConfig, threadList, allThreadList, projectList },
    optional: { skillResult, mcpResult, pluginResult, pluginMarketplaceResult, usageResult },
  };
}

function reportOptionalLoadFailures(
  results: ReadonlyArray<readonly [domain: string, result: PromiseSettledResult<unknown>]>,
): void {
  for (const [domain, result] of results) {
    if (result.status === 'rejected') console.warn(`[runtime] optional ${domain} state failed to load`, result.reason);
  }
}

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
    // 受限的渲染进程环境中可能无法使用 localStorage，此时 runtime 回退方案仍然有效。
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
  return run.status === 'running' || (
    run.status === 'pending_approval'
    && run.approvalStatus !== 'approved'
    && run.approvalStatus !== 'rejected'
    && run.approvalStatus !== 'cancelled'
  );
}

function approvalStatusForDecision(decision: AnswerRuntimeApprovalInput['decision']): Exclude<RuntimeApprovalStatus, 'pending'> {
  if (decision === 'cancel') return 'cancelled';
  if (decision === 'reject') return 'rejected';
  return 'approved';
}
