import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { buildSidebarSearchResults } from '../../../../src/app/sidebar/sidebarSearchResults.js';

describe('buildSidebarSearchResults', () => {
  it('ranks title matches before message matches returned by runtime search', () => {
    const results = buildSidebarSearchResults({
      projectFallback: 'Project',
      projectNameById: new Map([['project_1', 'Setsuna']]),
      query: 'needle',
      threads: [
        summary({
          id: 'message-match',
          projectId: 'project_1',
          searchMatchPreview: 'Older content with a needle inside it.',
          title: 'General discussion',
        }),
        summary({ id: 'title-match', title: 'Needle planning' }),
      ],
    });

    expect(results.map((result) => result.thread.id)).toEqual(['title-match', 'message-match']);
    expect(results[1]).toMatchObject({
      matchText: expect.stringContaining('needle'),
      sourceLabel: 'Setsuna',
    });
  });
});

function summary(overrides: Partial<RuntimeThreadSummary>): RuntimeThreadSummary {
  return {
    id: 'thread',
    title: 'Thread',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    archived: false,
    messageCount: 1,
    lastMessagePreview: 'Latest preview',
    ...overrides,
  };
}
