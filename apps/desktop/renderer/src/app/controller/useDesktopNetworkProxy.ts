import type {
  DesktopNetworkProxyRoutingInput,
  DesktopNetworkProxyServerInput,
  DesktopNetworkProxyState,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useState } from 'react';

export function useDesktopNetworkProxy() {
  const [state, setState] = useState<DesktopNetworkProxyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.setsunaDesktop?.networkProxy;
    if (!api) {
      setLoading(false);
      setError('当前环境不支持桌面代理设置。');
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
        if (active) setError(errorMessage(unknownError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const run = useCallback(async (
    action: (api: NonNullable<typeof window.setsunaDesktop>['networkProxy']) => Promise<DesktopNetworkProxyState>,
  ) => {
    const api = window.setsunaDesktop?.networkProxy;
    if (!api) throw new Error('当前环境不支持桌面代理设置。');
    setBusy(true);
    setError(null);
    try {
      const nextState = await action(api);
      setState(nextState);
      return nextState;
    } catch (unknownError) {
      const message = errorMessage(unknownError);
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }, []);

  const upsertServer = useCallback(
    (input: DesktopNetworkProxyServerInput) => run((api) => api.upsertServer(input)),
    [run],
  );
  const deleteServer = useCallback(
    (proxyServerId: string) => run((api) => api.deleteServer(proxyServerId)),
    [run],
  );
  const setRouting = useCallback(
    (input: DesktopNetworkProxyRoutingInput) => run((api) => api.setRouting(input)),
    [run],
  );

  return { busy, deleteServer, error, loading, setRouting, state, upsertServer };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type DesktopNetworkProxyStateView = ReturnType<typeof useDesktopNetworkProxy>;
