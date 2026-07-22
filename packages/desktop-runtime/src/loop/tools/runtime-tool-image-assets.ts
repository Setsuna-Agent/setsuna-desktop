import {
  isRuntimeInlineMessageAttachment,
  type RuntimeInlineMessageAttachment,
  type RuntimeMessage,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import type { GeneratedImageStore } from '../../ports/generated-image-store.js';

/**
 * Moves model-visible tool image bytes out of the append-only thread before the
 * tool message is published. The opaque asset is resolved only while composing
 * a provider request, so compaction and event snapshots never copy Base64 data.
 */
export async function externalizeToolImageAttachments(
  attachments: RuntimeMessage['attachments'],
  store?: GeneratedImageStore,
): Promise<RuntimeMessage['attachments']> {
  if (!store || !attachments?.some(isExternalizableToolImage)) return attachments;

  const createdAssetIds: string[] = [];
  try {
    const externalized: RuntimeMessageAttachment[] = [];
    for (const attachment of attachments) {
      if (!isExternalizableToolImage(attachment)) {
        externalized.push(attachment);
        continue;
      }
      const data = decodeBase64DataUrl(attachment.url);
      const stored = await store.create({
        data,
        name: attachment.name,
        type: attachment.type,
      });
      createdAssetIds.push(stored.assetId);
      externalized.push({
        id: attachment.id,
        assetId: stored.assetId,
        source: 'generated',
        name: attachment.name,
        type: attachment.type,
        size: data.byteLength,
        modelVisible: attachment.modelVisible ?? true,
      });
    }
    return externalized;
  } catch (error) {
    await Promise.allSettled(createdAssetIds.map((assetId) => store.delete(assetId)));
    throw error;
  }
}

function isExternalizableToolImage(attachment: RuntimeMessageAttachment): attachment is RuntimeInlineMessageAttachment {
  return isRuntimeInlineMessageAttachment(attachment)
    && attachment.modelVisible !== false
    && attachment.type.startsWith('image/')
    && attachment.url.startsWith('data:');
}

function decodeBase64DataUrl(value: string): Buffer {
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/]*={0,2})$/u.exec(value);
  if (!match) throw new Error('Tool image attachment is not a valid Base64 data URL.');
  const encoded = match[1]!;
  const data = Buffer.from(encoded, 'base64');
  if (!data.byteLength || normalizedBase64(data.toString('base64')) !== normalizedBase64(encoded)) {
    throw new Error('Tool image attachment contains invalid Base64 data.');
  }
  return data;
}

function normalizedBase64(value: string): string {
  return value.replace(/=+$/u, '');
}
