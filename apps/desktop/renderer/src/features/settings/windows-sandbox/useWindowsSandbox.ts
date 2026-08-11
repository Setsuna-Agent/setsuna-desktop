import type {
  DesktopWindowsSandboxAction,
  DesktopWindowsSandboxStatus,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

type WindowsSandboxController = {
  busyAction: DesktopWindowsSandboxAction | 'refresh' | null;
  error: string | null;
  refresh(): Promise<void>;
  runAction(action: DesktopWindowsSandboxAction): Promise<void>;
  status: DesktopWindowsSandboxStatus | null;
};

export function useWindowsSandbox(): WindowsSandboxController {
  const requestSequence = useRef(0);
  const [status, setStatus] = useState<DesktopWindowsSandboxStatus | null>(null);
  const [busyAction, setBusyAction] = useState<WindowsSandboxController['busyAction']>('refresh');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    const api = window.setsunaDesktop?.windowsSandbox;
    if (!api) {
      setBusyAction(null);
      setError('Windows sandbox management is unavailable.');
      return;
    }
    setBusyAction('refresh');
    setError(null);
    try {
      const nextStatus = await api.getStatus();
      if (requestId === requestSequence.current) setStatus(nextStatus);
    } catch (unknownError) {
      if (requestId === requestSequence.current) setError(errorMessage(unknownError));
    } finally {
      if (requestId === requestSequence.current) setBusyAction(null);
    }
  }, []);

  const runAction = useCallback(async (action: DesktopWindowsSandboxAction) => {
    const requestId = ++requestSequence.current;
    const api = window.setsunaDesktop?.windowsSandbox;
    if (!api) {
      setBusyAction(null);
      setError('Windows sandbox management is unavailable.');
      return;
    }
    setBusyAction(action);
    setError(null);
    try {
      const nextStatus = await api.runAction(action);
      if (requestId === requestSequence.current) setStatus(nextStatus);
    } catch (unknownError) {
      if (requestId === requestSequence.current) setError(errorMessage(unknownError));
    } finally {
      if (requestId === requestSequence.current) setBusyAction(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  return { busyAction, error, refresh, runAction, status };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Windows sandbox operation failed.');
}
