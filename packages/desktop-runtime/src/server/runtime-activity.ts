import type { EventBus } from '../ports/event-bus.js';

export function observeRuntimeActivity(bus: EventBus, publish: (activeTurns: number) => void): () => void {
  const active = new Map<string, string>();
  const report = () => {
    // Optional desktop observation must never fail a persisted turn or shutdown.
    try { void Promise.resolve(publish(active.size)).catch(() => undefined); } catch { /* Best effort. */ }
  };
  const unsubscribe = bus.subscribeAll((event) => {
    const before = active.size;
    if (event.type === 'turn.started' && event.turnId) active.set(event.turnId, event.threadId);
    if (event.type === 'turn.completed' || event.type === 'turn.cancelled' || event.type === 'runtime.error') {
      if (event.turnId) active.delete(event.turnId);
      else for (const [turnId, threadId] of active) if (threadId === event.threadId) active.delete(turnId);
    }
    if (before !== active.size) report();
  });
  return () => { unsubscribe(); active.clear(); report(); };
}
