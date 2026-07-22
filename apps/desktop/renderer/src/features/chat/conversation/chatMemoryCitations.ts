import type { RuntimeMemoryCitationEntry, RuntimeMessage } from '@setsuna-desktop/contracts';

/** 收集跨多个助手片段的稳定且去重后的记忆引用。 */
export function memoryCitationEntriesFromMessages(messages: RuntimeMessage[]): RuntimeMemoryCitationEntry[] {
  const entries = messages.flatMap((message) => message.memoryCitation?.entries ?? []);
  return [...new Map(entries.map((entry) => [memoryCitationEntryKey(entry), entry])).values()];
}

function memoryCitationEntryKey(entry: RuntimeMemoryCitationEntry): string {
  return `${entry.path}:${entry.lineStart}:${entry.lineEnd}`;
}
