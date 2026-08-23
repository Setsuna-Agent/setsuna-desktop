import type { DesktopWindowCloseBehavior } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

type DesktopWindowCloseBehaviorState = {
  closeBehavior: DesktopWindowCloseBehavior | null;
  error: boolean;
  pending: boolean;
  setCloseBehavior(closeBehavior: DesktopWindowCloseBehavior): Promise<void>;
};

export function useDesktopWindowCloseBehavior(enabled: boolean): DesktopWindowCloseBehaviorState {
  const requestSequence = useRef(0);
  const [closeBehavior, setCloseBehaviorState] = useState<DesktopWindowCloseBehavior | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(enabled);

  useEffect(() => {
    const requestId = ++requestSequence.current;
    if (!enabled) {
      setCloseBehaviorState(null);
      setError(false);
      setPending(false);
      return;
    }
    const api = window.setsunaDesktop?.windowControls;
    if (!api) {
      setError(true);
      setPending(false);
      return;
    }

    setPending(true);
    setError(false);
    void api.getCloseBehavior().then((value) => {
      if (requestId === requestSequence.current) setCloseBehaviorState(value);
    }).catch(() => {
      if (requestId === requestSequence.current) setError(true);
    }).finally(() => {
      if (requestId === requestSequence.current) setPending(false);
    });

    return () => {
      requestSequence.current += 1;
    };
  }, [enabled]);

  const setCloseBehavior = useCallback(async (nextCloseBehavior: DesktopWindowCloseBehavior) => {
    const api = window.setsunaDesktop?.windowControls;
    if (!enabled || !api) {
      setError(true);
      return;
    }
    const requestId = ++requestSequence.current;
    const previousCloseBehavior = closeBehavior ?? 'quit';
    setCloseBehaviorState(nextCloseBehavior);
    setPending(true);
    setError(false);
    try {
      const savedCloseBehavior = await api.setCloseBehavior(nextCloseBehavior);
      if (requestId === requestSequence.current) setCloseBehaviorState(savedCloseBehavior);
    } catch {
      if (requestId === requestSequence.current) {
        setCloseBehaviorState(previousCloseBehavior);
        setError(true);
      }
    } finally {
      if (requestId === requestSequence.current) setPending(false);
    }
  }, [closeBehavior, enabled]);

  return { closeBehavior, error, pending, setCloseBehavior };
}
