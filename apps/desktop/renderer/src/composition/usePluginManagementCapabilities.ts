import { useCallback, useMemo } from 'react';
import { usePluginManagementFeature } from './PluginManagementFeatureBoundary.js';

type PluginManagementCapabilityDependencies = Readonly<{
  refreshCapabilities(): Promise<void>;
  refreshCapabilityDependencies(): Promise<unknown>;
}>;

/** Adapts the Feature service to the mixed Plugin/Skill/MCP capabilities host surface. */
export function usePluginManagementCapabilities({
  refreshCapabilities,
  refreshCapabilityDependencies,
}: PluginManagementCapabilityDependencies) {
  const { service, snapshot } = usePluginManagementFeature();

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
    if (result) await refreshCapabilityDependencies();
    return result;
  }, [refreshCapabilityDependencies, service]);

  const installMarketplace = useCallback(async (pluginId: string) => {
    const result = await service.installMarketplace({ pluginId });
    await refreshCapabilityDependencies();
    return result;
  }, [refreshCapabilityDependencies, service]);

  const updateMarketplace = useCallback(async (pluginId: string) => {
    const result = await service.updateMarketplace({ pluginId });
    await refreshCapabilityDependencies();
    return result;
  }, [refreshCapabilityDependencies, service]);

  const remove = useCallback(async (pluginId: string) => {
    await service.remove({ pluginId });
    await refreshCapabilityDependencies();
  }, [refreshCapabilityDependencies, service]);

  const setExtensionTrust = useCallback(async (pluginId: string, trusted: boolean) => {
    await service.setExtensionTrust({ pluginId, trusted });
  }, [service]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshCapabilities(), service.refresh()]);
  }, [refreshCapabilities, service]);

  const values = useMemo(() => ({
    extensions: [...snapshot.extensions],
    marketplace: [...snapshot.marketplace],
    marketplaceErrors: [...snapshot.marketplaceErrors],
    plugins: [...snapshot.plugins],
  }), [snapshot]);

  return {
    ...values,
    getItemContent,
    installLocal,
    installMarketplace,
    refresh,
    remove,
    setExtensionTrust,
    updateMarketplace,
  };
}
