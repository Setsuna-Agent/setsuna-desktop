import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';

export type SidebarSearchResult = {
  isBusy: boolean;
  matchText?: string;
  rank: number;
  sourceLabel: string;
  thread: RuntimeThreadSummary;
  timestamp: number;
};

export function buildSidebarSearchResults({
  projectFallback,
  projectNameById,
  query,
  threads,
}: {
  projectFallback: string;
  projectNameById: ReadonlyMap<string, string>;
  query: string;
  threads: RuntimeThreadSummary[];
}): SidebarSearchResult[] {
  const keyword = query.trim().toLowerCase();
  return threads
    .map((thread) => {
      const title = compactSearchText(thread.title);
      const messageText = compactSearchText(thread.searchMatchPreview ?? thread.lastMessagePreview);
      const titleText = title.toLowerCase();
      const messageSearchText = messageText.toLowerCase();
      const titleStartsWithKeyword = Boolean(keyword && titleText.startsWith(keyword));
      const titleIncludesKeyword = Boolean(keyword && titleText.includes(keyword));
      const messageIncludesKeyword = Boolean(keyword && messageSearchText.includes(keyword));
      return {
        isBusy: Boolean(thread.activeTurnId),
        thread,
        sourceLabel: thread.projectId ? projectNameById.get(thread.projectId) ?? projectFallback : 'agent',
        matchText: keyword && messageIncludesKeyword ? buildSearchSnippet(messageText, keyword) : undefined,
        rank: !keyword ? 3 : titleStartsWithKeyword ? 0 : titleIncludesKeyword ? 1 : messageIncludesKeyword ? 2 : 9,
        timestamp: Date.parse(thread.updatedAt || thread.createdAt || '') || 0,
      };
    })
    .filter((item) => !keyword || item.rank < 9)
    .sort((left, right) => left.rank - right.rank || right.timestamp - left.timestamp)
    .slice(0, 30);
}

function compactSearchText(value?: string | null): string {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function buildSearchSnippet(text: string, keyword: string): string {
  if (!text) return '';
  const index = text.toLowerCase().indexOf(keyword);
  if (index < 0) return text.slice(0, 90);
  const start = Math.max(0, index - 22);
  const end = Math.min(text.length, index + keyword.length + 52);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
}
