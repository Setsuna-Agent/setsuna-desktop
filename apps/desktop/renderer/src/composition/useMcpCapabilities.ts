import type {
  RuntimeMcpServer,
  RuntimeMcpServerInput,
} from '@setsuna-desktop/contracts';
import { useCallback } from 'react';
import { useMcpFeature } from './McpFeatureBoundary.js';

/** Adapts the Feature service to the existing Capabilities page presentation props. */
export function useMcpCapabilities() {
  const { service, snapshot } = useMcpFeature();

  const saveServer = useCallback(async (input: RuntimeMcpServerInput) => {
    await service.saveServer(input);
  }, [service]);

  const discoverTools = useCallback((input: RuntimeMcpServerInput) => (
    service.discoverTools(input)
  ), [service]);

  const refresh = useCallback(() => service.refresh(), [service]);

  const updateServer = useCallback(async (
    server: RuntimeMcpServer,
    patch: Pick<RuntimeMcpServer, 'enabled'>,
  ) => {
    await service.updateServer(server.key, patch);
  }, [service]);

  const deleteServer = useCallback(async (server: RuntimeMcpServer) => {
    await service.deleteServer(server.key);
  }, [service]);

  const login = useCallback(async (server: RuntimeMcpServer) => {
    await service.login(server.key);
  }, [service]);

  const logout = useCallback(async (server: RuntimeMcpServer) => {
    await service.logout(server.key);
  }, [service]);

  return {
    deleteServer,
    discoverTools,
    login,
    logout,
    refresh,
    saveServer,
    snapshot,
    updateServer,
  };
}
