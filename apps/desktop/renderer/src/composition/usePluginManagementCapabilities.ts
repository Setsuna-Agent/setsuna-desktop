import { useCallback, useEffect, useMemo } from 'react';
import { reportRuntimeBackgroundFailure } from '../services/runtime-client/runtimeClientErrors.js';
import { usePluginManagementFeature } from './PluginManagementFeatureBoundary.js';

type PluginManagementCapabilityDependencies = Readonly<{
  activeProjectPath?: string;
  refreshDependencies(): Promise<void>;
}>;

/** Adapts the Feature service to the mixed Plugin/Skill/MCP capabilities host surface. */
export function usePluginManagementCapabilities({
  activeProjectPath,
  refreshDependencies,
}: PluginManagementCapabilityDependencies) {
  const { hookSnapshot, service, snapshot } = usePluginManagementFeature();

  useEffect(() => {
    void service.refreshHooks(activeProjectPath ? { cwd: activeProjectPath } : {}).catch((unknownError) => {
      reportRuntimeBackgroundFailure('Plugin Hook refresh', unknownError);
    });
  }, [activeProjectPath, service]);

  const refreshAfterPluginMutation = useCallback(async () => {
    await Promise.all([refreshDependencies(), service.refreshHooks()]);
  }, [refreshDependencies, service]);

  const getItemContent = useCallback((
    pluginId: string,
    kind: 'skill' | 'mcp' | 'hook' | 'resource',
    itemId: string,
    source: 'installed' | 'marketplace',
  ) => {
    const input = { pluginId, kind, itemId };
    return source === 'installed'
      ? service.getInstalledItem(input)
      : service.getMarketplaceItem(input);
  }, [service]);

  const installLocal = useCallback(async () => {
    const result = await service.installLocal();
    if (result) await refreshAfterPluginMutation();
    return result;
  }, [refreshAfterPluginMutation, service]);

  const installMarketplace = useCallback(async (pluginId: string) => {
    const result = await service.installMarketplace({ pluginId });
    await refreshAfterPluginMutation();
    return result;
  }, [refreshAfterPluginMutation, service]);

  const updateMarketplace = useCallback(async (pluginId: string) => {
    const result = await service.updateMarketplace({ pluginId });
    await refreshAfterPluginMutation();
    return result;
  }, [refreshAfterPluginMutation, service]);

  const remove = useCallback(async (pluginId: string) => {
    await service.remove({ pluginId });
    await refreshAfterPluginMutation();
  }, [refreshAfterPluginMutation, service]);

  const setExtensionTrust = useCallback(async (pluginId: string, trusted: boolean) => {
    await service.setExtensionTrust({ pluginId, trusted });
  }, [service]);

  const deleteStandaloneHook = useCallback(async (
    hook: Parameters<typeof service.deleteStandaloneHook>[0],
  ): Promise<void> => {
    await service.deleteStandaloneHook(hook);
  }, [service]);

  const setHookEnabled = useCallback(async (
    hook: Parameters<typeof service.setHookEnabled>[0],
    enabled: boolean,
  ): Promise<void> => {
    await service.setHookEnabled(hook, enabled);
  }, [service]);

  const setHookTrust = useCallback(async (
    hook: Parameters<typeof service.setHookTrust>[0],
    trusted: boolean,
  ): Promise<void> => {
    await service.setHookTrust(hook, trusted);
  }, [service]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshDependencies(), service.refresh(), service.refreshHooks()]);
  }, [refreshDependencies, service]);

  const values = useMemo(() => ({
    extensions: [...snapshot.extensions],
    hooks: [...hookSnapshot.hooks],
    marketplace: [...snapshot.marketplace],
    marketplaceErrors: [...snapshot.marketplaceErrors],
    plugins: [...snapshot.plugins],
  }), [hookSnapshot, snapshot]);

  return {
    ...values,
    getItemContent,
    installLocal,
    installMarketplace,
    refresh,
    remove,
    deleteStandaloneHook,
    setHookEnabled,
    setHookTrust,
    setExtensionTrust,
    updateMarketplace,
  };
}
