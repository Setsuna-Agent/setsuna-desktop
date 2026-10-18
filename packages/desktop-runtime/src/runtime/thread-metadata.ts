import type { RuntimeThreadMetadata, ThreadStore } from '../ports/thread-store.js';

/** Compatibility stores may fall back; SQLite reads this without decoding a transcript. */
export async function readRuntimeThreadMetadata(store: ThreadStore, threadId: string): Promise<RuntimeThreadMetadata | null> {
  return store.getThreadMetadata ? store.getThreadMetadata(threadId) : store.getThread(threadId);
}
