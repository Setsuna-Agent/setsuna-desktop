import { useCallback, useEffect, useRef, useState } from 'react';

const PANEL_TAB_CLOSE_FALLBACK_MS = 240;

type ClosingPanelWidths = Readonly<Record<string, number>>;

/**
 * Keeps a panel tab mounted until its exit animation finishes. The timeout is
 * a safety net for interrupted animations and intentionally survives an
 * unmount so a close click is never lost when the whole sidebar collapses.
 */
export function usePanelTabCloseTransition(onClosePanel?: (panelId: string) => void) {
  const [closingPanelWidths, setClosingPanelWidths] = useState<ClosingPanelWidths>({});
  const closeTimersRef = useRef(new Map<string, number>());
  const mountedRef = useRef(true);
  const onClosePanelRef = useRef(onClosePanel);

  useEffect(() => {
    onClosePanelRef.current = onClosePanel;
  }, [onClosePanel]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const finishPanelClose = useCallback((panelId: string) => {
    const timer = closeTimersRef.current.get(panelId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    closeTimersRef.current.delete(panelId);
    if (mountedRef.current) {
      setClosingPanelWidths((current) => {
        if (current[panelId] === undefined) return current;
        const next = { ...current };
        delete next[panelId];
        return next;
      });
    }
    onClosePanelRef.current?.(panelId);
  }, []);

  const startPanelClose = useCallback((panelId: string, width: number) => {
    if (closeTimersRef.current.has(panelId)) return;
    setClosingPanelWidths((current) => ({
      ...current,
      [panelId]: Math.max(0, width),
    }));
    const timer = window.setTimeout(() => finishPanelClose(panelId), PANEL_TAB_CLOSE_FALLBACK_MS);
    closeTimersRef.current.set(panelId, timer);
  }, [finishPanelClose]);

  return {
    closingPanelWidths,
    finishPanelClose,
    startPanelClose,
  };
}
