export const DEFAULT_THREAD_TITLE = 'New thread';
export const THREAD_TITLE_MAX_LENGTH = 48;

/**
 * Builds the deterministic title used while model-based title generation is
 * unavailable. Keep this shared so persisted and renderer projections agree.
 */
export function fallbackThreadTitle(content: string, attachmentCount = 0): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized) return normalized.slice(0, THREAD_TITLE_MAX_LENGTH);
  if (attachmentCount === 1) return '图片附件';
  if (attachmentCount > 1) return `${attachmentCount} 张图片`;
  return DEFAULT_THREAD_TITLE;
}
