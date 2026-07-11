import type { RuntimeMemoryCitationEntry, RuntimeMessage } from '@setsuna-desktop/contracts';

/** Collects stable, de-duplicated memory citations across a multi-segment assistant run. */
export function memoryCitationEntriesFromMessages(messages: RuntimeMessage[]): RuntimeMemoryCitationEntry[] {
  const entries = messages.flatMap((message) => message.memoryCitation?.entries ?? []);
  return [...new Map(entries.map((entry) => [memoryCitationEntryKey(entry), entry])).values()];
}

function memoryCitationEntryKey(entry: RuntimeMemoryCitationEntry): string {
  return `${entry.path}:${entry.lineStart}:${entry.lineEnd}`;
}
