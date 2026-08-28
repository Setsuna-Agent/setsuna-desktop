import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimeHookListResponse,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRuntimeHookManagement } from '../../features/capabilities/hooks/useRuntimeHookManagement.js';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';
import { reportRuntimeBackgroundFailure } from './runtimeClientErrors.js';

export type RuntimeCapabilityClient = Pick<
  DesktopRuntimeClient,
  | 'getConfig'
  | 'listHooks'
  | 'saveConfig'
>;

type RuntimeCapabilityStateOptions = {
  activeProjectPath?: string;
  client: RuntimeCapabilityClient;
  config: RuntimeConfigState | null;
  enabled: boolean;
  onConfigChange: (config: RuntimeConfigState) => void;
};

/** Owns the legacy Hook compatibility state until Plugin Management absorbs it. */
export function useRuntimeCapabilityState({
  activeProjectPath,
  client,
  config,
  enabled,
  onConfigChange,
}: RuntimeCapabilityStateOptions) {
  const [hookState, setHookState] = useState<RuntimeHookListResponse | null>(null);
  const capabilityRequests = useLatestRequestGuard();
  const activeHookCwds = useMemo(
    () => (activeProjectPath ? [activeProjectPath] : []),
    [activeProjectPath],
  );

  const refreshCapabilities = useCallback(async () => {
    const isLatestRequest = capabilityRequests.begin();
    const hookList = await client.listHooks(activeHookCwds);
    if (isLatestRequest()) setHookState(hookList);
    return hookList;
  }, [activeHookCwds, capabilityRequests, client]);

  const hookManagement = useRuntimeHookManagement({
    client,
    config,
    onConfigChange,
    refreshHooks: refreshCapabilities,
  });

  useEffect(() => {
    if (!enabled) return;
    void refreshCapabilities().catch((unknownError) => {
      reportRuntimeBackgroundFailure('hook refresh', unknownError);
    });
  }, [enabled, refreshCapabilities]);

  // Plugin mutations can update Hook bundles and their legacy config together.
  const refreshCapabilityDependencies = useCallback(async () => {
    const [nextConfig] = await Promise.all([
      client.getConfig(),
      refreshCapabilities(),
    ]);
    onConfigChange(nextConfig);
    return nextConfig;
  }, [client, onConfigChange, refreshCapabilities]);

  return {
    hookState,
    ...hookManagement,
    refreshCapabilities,
    refreshCapabilityDependencies,
  };
}
