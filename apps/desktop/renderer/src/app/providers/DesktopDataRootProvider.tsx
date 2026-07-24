import type { DesktopDataRootState } from '@setsuna-desktop/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type DesktopDataRootContextValue = {
  state: DesktopDataRootState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const DesktopDataRootContext = createContext<DesktopDataRootContextValue | null>(null);

export function DesktopDataRootProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DesktopDataRootState | null>(null);
  const [loading, setLoading] = useState(Boolean(window.setsunaDesktop?.dataRoot));
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const api = window.setsunaDesktop?.dataRoot;
    if (!api) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setState(await api.getState());
      setError(null);
    } catch (unknownError) {
      setError(errorMessage(unknownError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const api = window.setsunaDesktop?.dataRoot;
    if (!api) return undefined;
    let active = true;
    const unsubscribe = api.onStateChange((nextState) => {
      if (!active) return;
      setState(nextState);
      setError(null);
      setLoading(false);
    });
    void refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ state, loading, error, refresh }),
    [state, loading, error, refresh],
  );
  return (
    <DesktopDataRootContext.Provider value={value}>
      {children}
    </DesktopDataRootContext.Provider>
  );
}

export function useDesktopDataRoot(): DesktopDataRootContextValue {
  const value = useContext(DesktopDataRootContext);
  if (!value) throw new Error('useDesktopDataRoot must be used inside DesktopDataRootProvider.');
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
