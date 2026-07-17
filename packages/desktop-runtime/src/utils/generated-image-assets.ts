import {
  isRuntimeGeneratedMessageAttachment,
  isRuntimeInlineMessageAttachment,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';

type ThreadMessages = Pick<RuntimeThread, 'messages'>;

type GeneratedImageReferenceReader = {
  listThreads(query?: { includeArchived?: boolean }): Promise<readonly { id: string }[]>;
  getThread(threadId: string): Promise<ThreadMessages | null>;
};

/** Collects new opaque generated assets plus legacy inline attachments that still own a local copy. */
export function managedGeneratedImageAssetIds(thread: ThreadMessages | null | undefined): Set<string> {
  const assetIds = new Set<string>();
  for (const message of thread?.messages ?? []) {
    for (const attachment of message.attachments ?? []) {
      if (isRuntimeGeneratedMessageAttachment(attachment)) {
        assetIds.add(attachment.assetId);
      } else if (isRuntimeInlineMessageAttachment(attachment) && attachment.localAssetId) {
        assetIds.add(attachment.localAssetId);
      }
    }
  }
  return assetIds;
}

/**
 * Scans snapshots one at a time to avoid concurrently cloning every thread history.
 * When candidates are supplied, the scan stops as soon as every candidate is found.
 */
export async function managedGeneratedImageAssetIdsFromStore(
  store: GeneratedImageReferenceReader,
  candidates?: ReadonlySet<string>,
): Promise<Set<string>> {
  const assetIds = new Set<string>();
  const remaining = candidates ? new Set(candidates) : null;
  if (remaining?.size === 0) return assetIds;

  const threads = await store.listThreads({ includeArchived: true });
  for (const thread of threads) {
    const snapshot = await store.getThread(thread.id);
    for (const assetId of managedGeneratedImageAssetIds(snapshot)) {
      if (remaining && !remaining.has(assetId)) continue;
      assetIds.add(assetId);
      remaining?.delete(assetId);
    }
    if (remaining?.size === 0) break;
  }
  return assetIds;
}
