import type { BrowserHistoryEntry } from '../browserHistory.js';

export function browserHistoryDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function groupBrowserHistory(entries: readonly BrowserHistoryEntry[], query: string) {
  const groups = new Map<string, { day: string; timestamp: number; entries: BrowserHistoryEntry[] }>();
  const search = query.trim().toLowerCase();
  for (const entry of entries) {
    if (search && !`${entry.title} ${entry.url}`.toLowerCase().includes(search)) continue;
    const day = browserHistoryDay(entry.visitedAt);
    const group = groups.get(day) ?? { day, timestamp: entry.visitedAt, entries: [] };
    group.entries.push(entry);
    groups.set(day, group);
  }
  return [...groups.values()];
}
