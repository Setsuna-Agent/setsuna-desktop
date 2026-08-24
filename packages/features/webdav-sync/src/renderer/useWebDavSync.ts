import type {
  DesktopWebDavSyncBackupResult,
  DesktopWebDavSyncCategorySummary,
  DesktopWebDavSyncConfigureInput,
  DesktopWebDavSyncConfigureResult,
  DesktopWebDavSyncPreferencesInput,
  DesktopWebDavSyncRestorePlan,
  DesktopWebDavSyncRestorePlanInput,
  DesktopWebDavSyncSnapshotList,
  DesktopWebDavSyncState,
  WebDavSyncDesktopBridge,
} from '../contracts/index.js';
import { useCallback, useEffect, useState } from 'react';
import { useWebDavSyncView } from './context.js';

type WebDavSyncApi = WebDavSyncDesktopBridge;

export function useDesktopWebDavSync() {
  const { bridge } = useWebDavSyncView();
  const [state, setState] = useState<DesktopWebDavSyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = bridge;
    if (!api) {
      setLoading(false);
      setError('当前环境不支持 WebDAV 同步。');
      return undefined;
    }
    let active = true;
    const unsubscribe = api.onStateChange((nextState) => {
      if (active) setState(nextState);
    });
    void api.getState()
      .then((nextState) => {
        if (active) setState(nextState);
      })
      .catch((unknownError: unknown) => {
        if (active) setError(desktopWebDavSyncErrorMessage(unknownError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  const run = useCallback(async <T>(
    action: (api: WebDavSyncApi) => Promise<T>,
    stateFromResult?: (result: T) => DesktopWebDavSyncState | undefined,
  ): Promise<T> => {
    const api = bridge;
    if (!api) throw new Error('当前环境不支持 WebDAV 同步。');
    setError(null);
    try {
      const result = await action(api);
      const nextState = stateFromResult?.(result);
      if (nextState) setState(nextState);
      return result;
    } catch (unknownError) {
      const message = desktopWebDavSyncErrorMessage(unknownError);
      setError(message);
      throw new Error(message);
    }
  }, [bridge]);

  const configure = useCallback(
    (input: DesktopWebDavSyncConfigureInput): Promise<DesktopWebDavSyncConfigureResult> =>
      run((api) => api.configure(input), (result) => result.state),
    [run],
  );
  const getLocalCategorySummaries = useCallback(
    (): Promise<DesktopWebDavSyncCategorySummary[]> =>
      run((api) => api.getLocalCategorySummaries()),
    [run],
  );
  const revealRecoveryKey = useCallback(
    (): Promise<string> => run((api) => api.revealRecoveryKey()),
    [run],
  );
  const resetLocalConfiguration = useCallback(
    () => run((api) => api.resetLocalConfiguration(), (result) => result),
    [run],
  );
  const updatePreferences = useCallback(
    (input: DesktopWebDavSyncPreferencesInput) =>
      run((api) => api.updatePreferences(input), (result) => result),
    [run],
  );
  const testConnection = useCallback(
    (input?: DesktopWebDavSyncConfigureInput) =>
      run((api) => api.testConnection(input), (result) => result),
    [run],
  );
  const backupNow = useCallback(
    (): Promise<DesktopWebDavSyncBackupResult> =>
      run((api) => api.backupNow(), (result) => result.state),
    [run],
  );
  const listSnapshots = useCallback(
    (): Promise<DesktopWebDavSyncSnapshotList> => run((api) => api.listSnapshots()),
    [run],
  );
  const inspectRestore = useCallback(
    (input: DesktopWebDavSyncRestorePlanInput): Promise<DesktopWebDavSyncRestorePlan> =>
      run((api) => api.inspectRestore(input)),
    [run],
  );
  const restore = useCallback(
    (planId: string) => run((api) => api.restore(planId)),
    [run],
  );
  const cancelCurrentOperation = useCallback(
    () => run((api) => api.cancelCurrentOperation(), (result) => result),
    [run],
  );
  const disconnect = useCallback(
    () => run((api) => api.disconnect(), (result) => result),
    [run],
  );

  return {
    backupNow,
    cancelCurrentOperation,
    configure,
    disconnect,
    error,
    getLocalCategorySummaries,
    inspectRestore,
    listSnapshots,
    loading,
    revealRecoveryKey,
    resetLocalConfiguration,
    restore,
    state,
    testConnection,
    updatePreferences,
  };
}

export function desktopWebDavSyncErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u, '')
    .replace(/^Error:\s*/u, '');
}
