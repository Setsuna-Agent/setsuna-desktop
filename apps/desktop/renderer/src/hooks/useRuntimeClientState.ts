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
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillSummary,
  RuntimeThread,
  RuntimeThreadSummary,
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
  const terminalTurnIdsRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setError(null);
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

  useEffect(() => {
    unsubscribeRef.current?.();
    if (!currentThread) return undefined;
    unsubscribeRef.current = client.subscribeEvents(currentThread.id, currentThread.lastSeq, (event) => {
      setCurrentThread((thread) => (thread && thread.id === event.threadId ? applyRuntimeEvent(thread, event) : thread));
      if (isActivityEvent(event)) {
        setActivityEvents((items) => [event, ...items.filter((item) => item.id !== event.id)].slice(0, 80));
      }
      void client.listThreads().then((list) => setThreads(list.threads));
      if (event.type === 'turn.started' && event.turnId) {
        terminalTurnIdsRef.current.delete(event.turnId);
        setActiveTurnId(event.turnId);
      }
      if ((event.type === 'turn.completed' || event.type === 'turn.cancelled' || event.type === 'runtime.error') && event.turnId) {
        terminalTurnIdsRef.current.add(event.turnId);
        setActiveTurnId((current) => (current === event.turnId ? null : current));
      }
      if (event.type === 'runtime.error') {
        setError(event.payload.message);
      }
      if (event.type === 'turn.completed' && event.payload.usage) void client.getUsage().then(setUsage);
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
  }, [client, currentThread]);

  useEffect(() => {
    setActivityEvents([]);
    terminalTurnIdsRef.current.clear();
    setActiveTurnId(null);
  }, [currentThread?.id]);

  useEffect(() => {
    if (!activeTurnId || !currentThread) return undefined;
    let cancelled = false;
    let timeoutId: number | undefined;
    const threadId = currentThread.id;
    const turnId = activeTurnId;

    const pollThread = async () => {
      try {
        const nextThread = await client.getThread(threadId);
        if (cancelled) return;
        setCurrentThread((thread) => (thread?.id === threadId ? nextThread : thread));
        void client.listThreads().then((list) => {
          if (!cancelled) setThreads(list.threads);
        });
        if (turnHasFinished(nextThread, turnId)) {
          terminalTurnIdsRef.current.add(turnId);
          setActiveTurnId((current) => (current === turnId ? null : current));
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
  }, [activeTurnId, client, currentThread?.id]);

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

  const saveMemory = useCallback(
    async (content: string, sourceThreadId?: string | null) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      await client.createMemory({
        content: trimmed,
        scope: activeProjectId ? 'project' : 'global',
        projectId: activeProjectId ?? undefined,
        sourceThreadId: sourceThreadId ?? undefined,
      });
      const list = await client.listMemories({ projectId: activeProjectId ?? undefined, limit: 20 });
      setMemories(list.memories);
    },
    [activeProjectId, client],
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
      setApprovals((items) =>
        items.map((item) =>
          item.id === approvalId
            ? {
                ...item,
                status: input.decision === 'approve' ? 'approved' : 'rejected',
                message: input.message,
                resolvedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
    },
    [client],
  );

  return {
    activeTurnId,
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
    saveMemory,
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

export type RuntimeClientState = ReturnType<typeof useRuntimeClientState>;

function turnHasFinished(thread: RuntimeThread, turnId: string): boolean {
  const turnMessages = thread.messages.filter((message) => message.turnId === turnId);
  if (!turnMessages.length) return false;
  if (turnMessages.some((message) => message.status === 'streaming')) return false;
  return turnMessages.some((message) => message.role === 'assistant' && (message.status === 'complete' || message.status === 'error' || Boolean(message.error)));
}
