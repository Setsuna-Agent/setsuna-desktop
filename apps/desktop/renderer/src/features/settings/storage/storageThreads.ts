import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';

export type StorageThreadFilter = { search: string; scope: 'all' | 'archived'; olderThanDays: number };

export function filterStorageThreads(threads: RuntimeThreadSummary[], filter: StorageThreadFilter, now: number) {
  const query = filter.search.trim().toLocaleLowerCase();
  const cutoff = now - filter.olderThanDays * 24 * 60 * 60 * 1000;
  return threads.filter((thread) => (
    (filter.scope === 'all' || thread.archived)
    && (!filter.olderThanDays || Date.parse(thread.updatedAt) < cutoff)
    && thread.title.toLocaleLowerCase().includes(query)
  )).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
