import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { filterStorageThreads } from '../../../../../src/features/settings/storage/storageThreads.js';

const now = Date.parse('2026-10-14T04:00:00Z');
function thread(id: string, daysAgo: number, archived = true): RuntimeThreadSummary {
  const date = new Date(now - daysAgo * 86_400_000).toISOString();
  return { id, title: `Project ${id}`, archived, updatedAt: date, createdAt: date, messageCount: 1, lastMessagePreview: '' };
}

describe('storage cleanup review filters', () => {
  it('intersects age, archive status and search so select-all includes only reviewed conversations', () => {
    const threads = [thread('old', 31), thread('boundary', 30), thread('recent', 2), thread('unarchived', 90, false)];
    expect(filterStorageThreads(threads, { scope: 'archived', olderThanDays: 30, search: ' PROJECT ' }, now)
      .map((item) => item.id)).toEqual(['old']);
    expect(filterStorageThreads(threads, { scope: 'all', olderThanDays: 0, search: '' }, now)
      .map((item) => item.id)).toEqual(['recent', 'boundary', 'old', 'unarchived']);
  });
});
