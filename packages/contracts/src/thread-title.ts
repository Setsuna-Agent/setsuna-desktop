export const DEFAULT_THREAD_TITLE = 'New thread';
export const THREAD_TITLE_MAX_LENGTH = 48;

/**
 * 构建模型标题生成不可用时采用的确定性标题。此逻辑保持共享，
 * 以确保持久化结果与渲染进程投影一致。
 */
export function fallbackThreadTitle(content: string, attachmentCount = 0): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized) return normalized.slice(0, THREAD_TITLE_MAX_LENGTH);
  if (attachmentCount === 1) return '附件';
  if (attachmentCount > 1) return `${attachmentCount} 个附件`;
  return DEFAULT_THREAD_TITLE;
}
