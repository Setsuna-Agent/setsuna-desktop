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

type WindowsSandboxApi = {
  getStatus(): Promise<DesktopWindowsSandboxStatus>;
  runAction(action: DesktopWindowsSandboxAction): Promise<DesktopWindowsSandboxStatus>;
};

type WindowsSandboxActionResult = {
  error: string | null;
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
      const result = await runWindowsSandboxActionAndReconcile(api, action);
      if (requestId === requestSequence.current) {
        if (result.status) setStatus(result.status);
        setError(result.error);
      }
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

/** Elevated setup may commit before its final validation fails; always reconcile the displayed state. */
export async function runWindowsSandboxActionAndReconcile(
  api: WindowsSandboxApi,
  action: DesktopWindowsSandboxAction,
): Promise<WindowsSandboxActionResult> {
  try {
    return { error: null, status: await api.runAction(action) };
  } catch (unknownError) {
    const actionError = errorMessage(unknownError);
    try {
      const status = await api.getStatus();
      return {
        error: actionReachedDesiredState(action, status) ? null : actionError,
        status,
      };
    } catch {
      return { error: actionError, status: null };
    }
  }
}

function actionReachedDesiredState(
  action: DesktopWindowsSandboxAction,
  status: DesktopWindowsSandboxStatus,
): boolean {
  return action === 'uninstall' ? status.state === 'not-installed' : status.state === 'ready';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Windows sandbox operation failed.');
}
