import type {
  DesktopRuntimeClient,
  RuntimePluginInstallResult,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
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
import {
  reportOptionalRuntimeLoadFailures,
  useRuntimeCapabilityState,
} from './useRuntimeCapabilityState.js';
import { useRuntimeConfigState } from './useRuntimeConfigState.js';
import { useRuntimeUsageState } from './useRuntimeUsageState.js';
import {
  useRuntimeThreadState,
  type RuntimeTurnSettlement,
} from './useRuntimeThreadState.js';

export type LoadState = 'loading' | 'ready' | 'error';

type RuntimeClientStateOptions = {
  activeProjectId: string | null;
  setActiveProjectId: Dispatch<SetStateAction<string | null>>;
};

/**
 * Renderer runtime facade. Domain hooks own their state while this layer coordinates
 * bootstrap and the few cross-domain refresh effects.
 */
export function useRuntimeClientState({
  activeProjectId,
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
  } = useRuntimeConfigState({ client });
  const {
    applyBootstrapResults: applyCapabilityBootstrapResults,
    refreshCapabilities,
    ...capabilityState
  } = useRuntimeCapabilityState({
    activeProjectPath,
    client,
    config: configState.config,
    enabled: loadState === 'ready',
    onConfigChange: replaceConfig,
  });
  const installLocalPlugin = useCallback(async (): Promise<RuntimePluginInstallResult | null> => {
    const install = window.setsunaDesktop?.plugins?.installLocal;
    if (!install) throw new Error('Local plugin installation is unavailable in this build.');
    const result = await install();
    if (!result) return null;
    await refreshCapabilities();
    return result;
  }, [refreshCapabilities]);
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

  const {
    applyBootstrapUsage,
    refreshThreadUsage,
    refreshUsage,
    ...usageState
  } = useRuntimeUsageState({
    client,
    currentThreadId,
  });

  // React hooks cannot form a dependency cycle. The stable forwarding callback lets the
  // thread owner emit settlements while always invoking the latest domain refreshers.
  turnSettlementHandlerRef.current = ({
    refreshThreadUsage: shouldRefreshThreadUsage,
    refreshUsage: shouldRefreshUsage,
    threadId,
  }) => {
    void refreshCapabilities().catch((unknownError) => {
      reportRuntimeBackgroundFailure('capability refresh after turn', unknownError);
    });
    if (shouldRefreshUsage) void refreshUsage();
    if (shouldRefreshThreadUsage) void refreshThreadUsage(threadId);
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
      const {
        mcpResult,
        pluginMarketplaceResult,
        pluginResult,
        skillResult,
        usageResult,
      } = bootstrap.optional;
      replaceConfig(nextConfig);
      setProjects(projectList.projects);
      const threadBootstrap = applyBootstrapThreads({
        allThreads: allThreadList.threads,
        projects: projectList.projects,
        visibleThreads: threadList.threads,
      });
      applyCapabilityBootstrapResults({
        skillResult,
        mcpResult,
        pluginResult,
        pluginMarketplaceResult,
      });
      applyBootstrapUsage(usageResult);
      reportOptionalRuntimeLoadFailures([
        ['skills', skillResult],
        ['MCP', mcpResult],
        ['plugins', pluginResult],
        ['plugin marketplace', pluginMarketplaceResult],
        ['usage', usageResult],
      ]);
      await threadBootstrap;
      setLoadState('ready');
    } catch (unknownError) {
      setLoadState('error');
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      throw unknownError;
    }
  }, [
    applyBootstrapThreads,
    applyBootstrapUsage,
    applyCapabilityBootstrapResults,
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
    ...usageState,
    ...threadState,
    client,
    error,
    installLocalPlugin,
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
  | 'getUsage'
  | 'listMcpServers'
  | 'listPluginMarketplace'
  | 'listPlugins'
  | 'listProjects'
  | 'listSkills'
  | 'listThreads'
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
  const [
    skillResult,
    mcpResult,
    pluginResult,
    pluginMarketplaceResult,
    usageResult,
  ] = optional;
  return {
    core: { nextConfig, threadList, allThreadList, projectList },
    optional: {
      skillResult,
      mcpResult,
      pluginResult,
      pluginMarketplaceResult,
      usageResult,
    },
  };
}
