import type { RuntimeMessage, RuntimeThreadSummary } from '@setsuna-desktop/contracts';

const SEARCH_CONTEXT_BEFORE = 22;
const SEARCH_CONTEXT_AFTER = 52;

export function normalizedThreadSearch(value?: string): string {
  return normalizeThreadSearchText(value ?? '');
}

export function normalizeThreadSearchText(value: string): string {
  return compactThreadSearchText(value).toLowerCase();
}

export function threadSummarySearchMatch(
  thread: RuntimeThreadSummary,
  search: string,
): { matches: boolean; preview?: string } {
  if (!search) return { matches: true };
  if (normalizeThreadSearchText(thread.title).includes(search)) return { matches: true };
  const preview = buildThreadSearchPreview(thread.lastMessagePreview, search);
  return preview ? { matches: true, preview } : { matches: false };
}

export function threadSearchResult(
  thread: RuntimeThreadSummary,
  search: string,
  messagePreview?: string,
): RuntimeThreadSummary[] {
  if (!search) return [thread];
  const summaryMatch = threadSummarySearchMatch(thread, search);
  const searchMatchPreview = summaryMatch.preview ?? messagePreview;
  return summaryMatch.matches || searchMatchPreview
    ? [{ ...thread, searchMatchPreview }]
    : [];
}

export function findThreadMessageSearchPreview(
  messages: readonly RuntimeMessage[],
  search: string,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const preview = buildThreadSearchPreview(messages[index]?.content ?? '', search);
    if (preview) return preview;
  }
  return undefined;
}

export function buildThreadSearchPreview(text: string, search: string): string | undefined {
  const compactText = compactThreadSearchText(text);
  const normalizedSearch = normalizeThreadSearchText(search);
  const matchIndex = normalizeThreadSearchText(compactText).indexOf(normalizedSearch);
  if (matchIndex < 0) return undefined;
  const start = Math.max(0, matchIndex - SEARCH_CONTEXT_BEFORE);
  const end = Math.min(compactText.length, matchIndex + normalizedSearch.length + SEARCH_CONTEXT_AFTER);
  return `${start > 0 ? '...' : ''}${compactText.slice(start, end)}${end < compactText.length ? '...' : ''}`;
}

function compactThreadSearchText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
