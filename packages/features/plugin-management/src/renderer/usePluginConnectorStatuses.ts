import type { RuntimePluginConnectorStatus } from '@setsuna-desktop/contracts';
import { useEffect, useState } from 'react';
import type { PluginManagementRendererService } from '../contracts/index.js';

export function usePluginConnectorStatuses(service: PluginManagementRendererService, pluginId?: string) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ pluginId?: string; statuses: RuntimePluginConnectorStatus[]; loading: boolean; failed: boolean }>({
    statuses: [], loading: false, failed: false,
  });
  useEffect(() => {
    if (!pluginId) return;
    const controller = new AbortController();
    setResult({ pluginId, statuses: [], loading: true, failed: false });
    void service.readConnectorStatuses({ pluginId }, { signal: controller.signal }).then((statuses) => {
      if (!controller.signal.aborted) setResult({ pluginId, statuses, loading: false, failed: false });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ pluginId, statuses: [], loading: false, failed: true });
    });
    return () => controller.abort();
  }, [pluginId, revision, service]);
  return {
    statuses: result.pluginId === pluginId ? result.statuses : [],
    loading: Boolean(pluginId) && (result.pluginId !== pluginId || result.loading),
    failed: result.pluginId === pluginId && result.failed,
    refresh: () => setRevision((value) => value + 1),
  };
}
