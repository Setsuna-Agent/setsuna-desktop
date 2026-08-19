import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { memoryStartupExtractionCandidates } from '../../../src/loop/memory/runtime-memory-coordinator.js';

const NOW = new Date('2026-07-20T12:00:00.000Z');

describe('memoryStartupExtractionCandidates', () => {
  it('sorts by most recently active before truncating so older but active threads are not starved', () => {
    const olderButActive = summary('thread_old', '2026-07-01T00:00:00.000Z', '2026-07-19T12:00:00.000Z');
    const newerIdle = summary('thread_new1', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z');
    const newestIdle = summary('thread_new2', '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z');

    // 输入沿用 listThreads 的创建时间倒序；若直接截断，thread_old 将永远排不进去。
    const candidates = memoryStartupExtractionCandidates([newestIdle, newerIdle, olderButActive], null, NOW, 2);

    expect(candidates.map((thread) => thread.id)).toEqual(['thread_old', 'thread_new2']);
  });

  it('filters ineligible threads before sorting and breaks updatedAt ties deterministically', () => {
    const tooRecent = summary('thread_recent', '2026-07-01T00:00:00.000Z', '2026-07-20T11:00:00.000Z');
    const eligibleA = summary('thread_a', '2026-07-02T00:00:00.000Z', '2026-07-19T00:00:00.000Z');
    const eligibleB = summary('thread_b', '2026-07-03T00:00:00.000Z', '2026-07-19T00:00:00.000Z');

    const candidates = memoryStartupExtractionCandidates([tooRecent, eligibleB, eligibleA], null, NOW, 2);

    expect(candidates.map((thread) => thread.id)).toEqual(['thread_a', 'thread_b']);
  });
});

function summary(id: string, createdAt: string, updatedAt: string): RuntimeThreadSummary {
  return {
    id,
    title: id,
    createdAt,
    updatedAt,
    archived: false,
    messageCount: 1,
    lastMessagePreview: '',
  };
}
