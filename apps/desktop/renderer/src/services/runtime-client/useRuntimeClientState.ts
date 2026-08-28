import type { DesktopRuntimeClient, WorkspaceProject } from '@setsuna-desktop/contracts';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createDesktopRuntimeClient } from './client.js';
import {
  reportRuntimeBackgroundFailure,
  runtimeClientErrorMessage,
} from './runtimeClientErrors.js';
import {
  discardRuntimeErrorFromOtherThread,
  runtimeErrorForThread,
  updateScopedRuntimeError,
  type ScopedRuntimeError,
} from './runtimeErrorState.js';
import { useRuntimeCapabilityState } from './useRuntimeCapabilityState.js';
import { useRuntimeConfigState, type ModelProviderProjectionService } from './useRuntimeConfigState.js';
import {
  useRuntimeThreadState,
  type RuntimeTurnSettlement,
} from './useRuntimeThreadState.js';

export type LoadState = 'loading' | 'ready' | 'error';

type RuntimeClientStateOptions = {
  activeProjectId: string | null;
  modelProvider: ModelProviderProjectionService;
  onTurnSettled?: (settlement: RuntimeTurnSettlement) => void;
  setActiveProjectId: Dispatch<SetStateAction<string | null>>;
};

/**
 * Renderer runtime facade. Domain hooks own their state while this layer coordinates
 * bootstrap and the few cross-domain refresh effects.
 */
export function useRuntimeClientState({
  activeProjectId,
  modelProvider,
  onTurnSettled,
  setActiveProjectId,
}: RuntimeClientStateOptions) {
  const client = useMemo(() => createDesktopRuntimeClient(), []);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [runtimeError, setRuntimeError] = useState<ScopedRuntimeError | null>(null);
  const currentThreadIdRef = useRef<string | null>(null);
  const setError = useCallback<Dispatch<SetStateAction<string | null>>>((update) => {
    setRuntimeError((current) => updateScopedRuntimeError(
      current,
      update,
      currentThreadIdRef.current,
    ));
  }, []);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const turnSettlementHandlerRef = useRef<(settlement: RuntimeTurnSettlement) => void>(
    () => undefined,
  );
  const forwardTurnSettlement = useCallback((settlement: RuntimeTurnSettlement) => {
    turnSettlementHandlerRef.current(settlement);
  }, []);
  const activeProjectPath = activeProjectId
    ? projects.find((project) => project.id === activeProjectId)?.path
    : undefined;

  const {
    replaceConfig,
    ...configState
  } = useRuntimeConfigState({ client, modelProvider });
  const {
    refreshCapabilities,
    ...capabilityState
  } = useRuntimeCapabilityState({
    activeProjectPath,
    client,
    config: configState.config,
    enabled: loadState === 'ready',
    onConfigChange: replaceConfig,
  });
  const {
    applyBootstrapThreads,
    ...threadState
  } = useRuntimeThreadState({
    activeProjectId,
    client,
    onError: setError,
    onTurnSettled: forwardTurnSettlement,
    setActiveProjectId,
  });
  const currentThreadId = threadState.currentThread?.id ?? null;
  currentThreadIdRef.current = currentThreadId;
  const error = runtimeErrorForThread(runtimeError, currentThreadId);

  useEffect(() => {
    setRuntimeError((current) => discardRuntimeErrorFromOtherThread(current, currentThreadId));
  }, [currentThreadId]);

  const selectConversationModel = useCallback(async (
    providerId: string,
    modelId: string,
    threadId?: string,
  ) => {
    setError(null);
    try {
      await Promise.all([
        configState.selectProviderModel(providerId, modelId),
        threadId
          ? client.updateThread(threadId, {
              modelSelection: { providerId, modelId },
            }).then(() => undefined)
          : Promise.resolve(),
      ]);
    } catch (unknownError) {
      setError(runtimeClientErrorMessage(unknownError));
      throw unknownError;
    }
  }, [client, configState.selectProviderModel, setError]);

  // React hooks cannot form a dependency cycle. The stable forwarding callback lets the
  // thread owner emit settlements while always invoking the latest domain refreshers.
  turnSettlementHandlerRef.current = (settlement) => {
    void refreshCapabilities().catch((unknownError) => {
      reportRuntimeBackgroundFailure('capability refresh after turn', unknownError);
    });
    onTurnSettled?.(settlement);
  };

  const refresh = useCallback(async () => {
    setLoadState('loading');
    setError(null);
    try {
      // 只有进入工作台必需的状态失败才是致命错误；可选功能域各自独立降级。
      const bootstrap = await loadRuntimeBootstrap(client);
      const {
        allThreadList,
        nextConfig,
        projectList,
        threadList,
      } = bootstrap.core;
      replaceConfig(nextConfig);
      setProjects(projectList.projects);
      const threadBootstrap = applyBootstrapThreads({
        allThreads: allThreadList.threads,
        projects: projectList.projects,
        visibleThreads: threadList.threads,
      });
      await threadBootstrap;
      setLoadState('ready');
    } catch (unknownError) {
      setLoadState('error');
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      throw unknownError;
    }
  }, [
    applyBootstrapThreads,
    client,
    replaceConfig,
    setError,
  ]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  return {
    ...capabilityState,
    ...configState,
    ...threadState,
    client,
    error,
    loadState,
    projects,
    refresh,
    refreshCapabilities,
    selectConversationModel,
    setError,
    setProjects,
  };
}

export type RuntimeClientState = ReturnType<typeof useRuntimeClientState>;

type RuntimeBootstrapClient = Pick<
  DesktopRuntimeClient,
  | 'getConfig'
  | 'listProjects'
  | 'listThreads'
>;

export async function loadRuntimeBootstrap(client: RuntimeBootstrapClient) {
  const [nextConfig, threadList, allThreadList, projectList] = await Promise.all([
    client.getConfig(),
    client.listThreads(),
    client.listThreads({ includeArchived: true }),
    client.listProjects(),
  ]);
  return {
    core: { nextConfig, threadList, allThreadList, projectList },
  };
}
