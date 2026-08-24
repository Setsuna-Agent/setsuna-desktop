import { useCallback, useEffect, useState } from 'react';
import type {
  RuntimeWorkspaceDependenciesStatus,
  WorkspaceDependencySettingsPatch,
  WorkspaceDependencySettingsState,
} from '../contracts/index.js';
import type { WorkspaceDependenciesClient } from './client.js';

export type WorkspaceDependencyAction = 'loading' | 'diagnose' | 'repair' | 'save';

export function useWorkspaceDependencies(client: WorkspaceDependenciesClient) {
  const [settings, setSettings] = useState<WorkspaceDependencySettingsState | null>(null);
  const [status, setStatus] = useState<RuntimeWorkspaceDependenciesStatus | null>(null);
  const [busyAction, setBusyAction] = useState<WorkspaceDependencyAction | null>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void client.read({ signal: abort.signal }).then((snapshot) => {
      if (abort.signal.aborted) return;
      setSettings(snapshot.settings);
      setStatus(snapshot.status);
      setError(null);
    }).catch((loadError: unknown) => {
      if (!abort.signal.aborted) setError(errorMessage(loadError));
    }).finally(() => {
      if (!abort.signal.aborted) setBusyAction(null);
    });
    return () => abort.abort();
  }, [client]);

  const runStatusAction = useCallback(async (
    action: 'diagnose' | 'repair',
    request: () => Promise<RuntimeWorkspaceDependenciesStatus>,
  ): Promise<void> => {
    setBusyAction(action);
    setError(null);
    try {
      const nextStatus = await request();
      setStatus(nextStatus);
      if (nextStatus.error) setError(nextStatus.error);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }, []);

  const save = useCallback(async (patch: WorkspaceDependencySettingsPatch): Promise<boolean> => {
    if (!settings) return false;
    setBusyAction('save');
    setError(null);
    try {
      setSettings(await client.updateSettings({ expectedRevision: settings.revision, patch }));
      return true;
    } catch (saveError) {
      setError(errorMessage(saveError));
      return false;
    } finally {
      setBusyAction(null);
    }
  }, [client, settings]);

  return {
    busyAction,
    diagnose: () => runStatusAction('diagnose', () => client.diagnose()),
    error,
    repair: () => runStatusAction('repair', () => client.repair()),
    save,
    settings,
    status,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
