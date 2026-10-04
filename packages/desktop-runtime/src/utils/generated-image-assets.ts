import {
  isRuntimeGeneratedMessageAttachment,
  isRuntimeInlineMessageAttachment,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';

type ThreadMessages = Pick<RuntimeThread, 'messages'>;

type GeneratedImageReferenceReader = {
  listThreads(query?: { includeArchived?: boolean; includeSide?: boolean; includeFeatures?: boolean }): Promise<readonly { id: string }[]>;
  getThread(threadId: string): Promise<ThreadMessages | null>;
  getSamplingState?(threadId: string): Promise<ThreadMessages | null>;
  getGeneratedImageAssetIds?(threadId: string): Promise<string[]>;
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
 * Prefers checkpoint reference IDs; older stores can read a coherent message snapshot.
 * When candidates are supplied, the scan stops as soon as every candidate is found.
 */
export async function managedGeneratedImageAssetIdsFromStore(
  store: GeneratedImageReferenceReader,
  candidates?: ReadonlySet<string>,
): Promise<Set<string>> {
  const assetIds = new Set<string>();
  const remaining = candidates ? new Set(candidates) : null;
  if (remaining?.size === 0) return assetIds;

  const threads = await store.listThreads({ includeArchived: true, includeSide: true, includeFeatures: true });
  for (const thread of threads) {
    const references = store.getGeneratedImageAssetIds
      ? await store.getGeneratedImageAssetIds(thread.id)
      : managedGeneratedImageAssetIds(await (store.getSamplingState ? store.getSamplingState(thread.id) : store.getThread(thread.id)));
    for (const assetId of references) {
      if (remaining && !remaining.has(assetId)) continue;
      assetIds.add(assetId);
      remaining?.delete(assetId);
    }
    if (remaining?.size === 0) break;
  }
  return assetIds;
}
