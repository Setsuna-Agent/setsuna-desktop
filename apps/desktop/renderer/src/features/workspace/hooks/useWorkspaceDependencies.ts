import type { RuntimeWorkspaceDependenciesStatus } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDesktopRuntimeClient } from '../../../services/runtime-client/client.js';

export type WorkspaceDependencyAction = 'loading' | 'toggle' | 'diagnose' | 'reinstall';

export function useWorkspaceDependencies() {
  const client = useMemo(() => createDesktopRuntimeClient(), []);
  const [status, setStatus] = useState<RuntimeWorkspaceDependenciesStatus | null>(null);
  const [busyAction, setBusyAction] = useState<WorkspaceDependencyAction | null>('loading');
  const [error, setError] = useState<string | null>(null);
  const [hasDiagnosed, setHasDiagnosed] = useState(false);

  useEffect(() => {
    let active = true;
    void client.getWorkspaceDependencies().then((nextStatus) => {
      if (!active) return;
      setStatus(nextStatus);
      setError(null);
    }).catch((unknownError: unknown) => {
      if (active) setError(errorMessage(unknownError));
    }).finally(() => {
      if (active) setBusyAction(null);
    });
    return () => {
      active = false;
    };
  }, [client]);

  const run = useCallback(async (
    action: Exclude<WorkspaceDependencyAction, 'loading'>,
    request: () => Promise<RuntimeWorkspaceDependenciesStatus>,
  ): Promise<RuntimeWorkspaceDependenciesStatus | null> => {
    setBusyAction(action);
    setError(null);
    try {
      const nextStatus = await request();
      setStatus(nextStatus);
      if (nextStatus.error) setError(nextStatus.error);
      return nextStatus;
    } catch (unknownError) {
      setError(errorMessage(unknownError));
      return null;
    } finally {
      setBusyAction(null);
    }
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => run('toggle', () => client.setWorkspaceDependencies({ enabled })),
    [client, run],
  );
  const diagnose = useCallback(
    async () => {
      const nextStatus = await run('diagnose', () => client.diagnoseWorkspaceDependencies());
      if (nextStatus) setHasDiagnosed(true);
      return nextStatus;
    },
    [client, run],
  );
  const reinstall = useCallback(
    () => run('reinstall', () => client.reinstallWorkspaceDependencies()),
    [client, run],
  );

  return {
    busyAction,
    diagnose,
    error,
    hasDiagnosed,
    reinstall,
    setEnabled,
    status,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
