import { useSyncExternalStore } from 'react';
import type { AssistantsSnapshot } from '../contracts/index.js';

type SnapshotSource = { snapshot(signal?: AbortSignal): Promise<AssistantsSnapshot> };

/**
 * One snapshot shared by the home entry, chat and information panel; edits never
 * need a second copy of the assistant configuration.
 */
export function createAssistantsStore(source: SnapshotSource) {
  let snapshot: AssistantsSnapshot | null = null;
  let latestRequest = 0;
  const listeners = new Set<() => void>();
  const publish = (next: AssistantsSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
    return next;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** A response is published only if no newer refresh started, so a slow poll cannot undo a mutation. */
    async refresh(signal?: AbortSignal): Promise<AssistantsSnapshot> {
      const request = ++latestRequest;
      const next = await source.snapshot(signal);
      return request === latestRequest && !signal?.aborted ? publish(next) : next;
    },
    /** Operations that already return a fresh snapshot publish it directly. */
    publish(next: AssistantsSnapshot) {
      latestRequest += 1;
      return publish(next);
    },
  };
}
export type AssistantsStore = ReturnType<typeof createAssistantsStore>;

export function useAssistantsSnapshot(store: AssistantsStore): AssistantsSnapshot | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
