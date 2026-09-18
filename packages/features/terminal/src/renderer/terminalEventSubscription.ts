import type { DesktopTerminalEvent, TerminalDesktopBridge } from '../contracts/index.js';
import { recordTerminalEventSeq, terminalLastEventSeq } from './terminalRestoreBuffer.js';

export function subscribeTerminalEvents(
  bridge: Pick<TerminalDesktopBridge, 'onEvent' | 'read'>,
  sessionId: string,
  onEvent: (event: DesktopTerminalEvent) => void,
  onRestored?: () => void,
): () => void {
  let disposed = false;
  let pendingEvents: DesktopTerminalEvent[] | null = [];

  const deliver = (event: DesktopTerminalEvent) => {
    if (disposed || event.seq <= terminalLastEventSeq(sessionId)) return;
    recordTerminalEventSeq(sessionId, event.seq);
    onEvent(event);
  };
  const unsubscribe = bridge.onEvent(sessionId, (event) => {
    if (disposed) return;
    if (pendingEvents) pendingEvents.push(event);
    else deliver(event);
  });

  const restore = (history: DesktopTerminalEvent[]) => {
    if (disposed) return;
    // Live IPC can beat the read response. Merge before advancing the sequence,
    // otherwise a newer chunk can cause the initial shell prompt to be skipped.
    const events = [...history, ...(pendingEvents ?? [])].sort((left, right) => left.seq - right.seq);
    pendingEvents = null;
    events.forEach(deliver);
    onRestored?.();
  };
  void bridge.read(sessionId).then(restore, () => restore([]));

  return () => {
    disposed = true;
    pendingEvents = null;
    unsubscribe();
  };
}
