import type { RuntimeMessage } from '@setsuna-desktop/contracts';

/** Normalize untrusted attachment input before it reaches turn coordinators. */
export function normalizeAttachments(value: unknown): NonNullable<RuntimeMessage['attachments']> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): NonNullable<RuntimeMessage['attachments']>[number] | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
      const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'attachment';
      const type = typeof record.type === 'string' && record.type.trim() ? record.type.trim() : 'application/octet-stream';
      const size = typeof record.size === 'number' && Number.isFinite(record.size)
        ? Math.max(0, Math.floor(record.size))
        : 0;
      if (record.source === 'runtime') {
        const assetId = typeof record.assetId === 'string' && record.assetId.trim()
          ? record.assetId.trim()
          : '';
        if (!id || !assetId) return null;
        return { id, assetId, source: 'runtime' as const, name, type, size };
      }
      const url = typeof record.url === 'string' && record.url.trim() ? record.url.trim() : '';
      if (!id || !url) return null;
      return { id, name, type, size, url };
    })
    .filter((item): item is NonNullable<RuntimeMessage['attachments']>[number] => Boolean(item));
}
