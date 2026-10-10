import { useEffect, useRef } from 'react';
import type { DesktopTerminalEvent, DesktopTerminalSession } from '../model.js';

export type TerminalSessionsByPanelId = Record<string, Record<string, DesktopTerminalSession>>;

/** Observe session lifetime even when its panel is hidden or in another conversation. */
export function useTerminalPanelExit(
  sessionsByPanel: TerminalSessionsByPanelId,
  onExit: (panelId: string, projectKey: string, sessionId: string) => void,
) {
  // Layout changes update the callback without rereading every background shell.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  useEffect(() => {
    const bridge = window.setsunaDesktop?.terminal;
    if (!bridge) return;
    const unsubscribers = Object.entries(sessionsByPanel).flatMap(([panelId, sessionsByProject]) =>
      Object.entries(sessionsByProject).map(([projectKey, session]) => {
        let disposed = false;
        let exited = false;
        let lifecycleSeq = 0;
        const handleEvent = (event: DesktopTerminalEvent) => {
          if (disposed || exited || event.seq <= lifecycleSeq) return;
          if (event.event !== 'ready' && event.event !== 'exit') return;
          lifecycleSeq = event.seq;
          if (event.event === 'exit') {
            exited = true;
            onExitRef.current(panelId, projectKey, session.sessionId);
          }
        };
        const unsubscribe = bridge.onEvent(session.sessionId, handleEvent);
        // Catch exits between subscriptions without advancing the terminal output's
        // replay cursor. Only the latest lifecycle event describes the current shell.
        void bridge.read(session.sessionId).then((events) => {
          const latest = events.reduce<DesktopTerminalEvent | undefined>((current, event) =>
            (event.event === 'ready' || event.event === 'exit') && (!current || event.seq > current.seq)
              ? event : current, undefined);
          if (latest) handleEvent(latest);
        }, () => undefined);
        return () => {
          disposed = true;
          unsubscribe();
        };
      }),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [sessionsByPanel]);
}
