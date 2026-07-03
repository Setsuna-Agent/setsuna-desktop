import { describe, expect, it } from 'vitest';
import { MemoryCitationStreamParser, parseMemoryCitationBodies, stripMemoryCitations } from './memory-citation.js';

describe('memory citation parser', () => {
  it('hides citations across stream chunk boundaries', () => {
    const parser = new MemoryCitationStreamParser();
    const first = parser.push('Hello <oai-mem-');
    const second = parser.push('citation>source A</oai-mem-');
    const third = parser.push('citation> world');
    const tail = parser.finish();

    expect(`${first.visibleText}${second.visibleText}${third.visibleText}${tail.visibleText}`).toBe('Hello  world');
    expect([...first.citations, ...second.citations, ...third.citations, ...tail.citations]).toEqual(['source A']);
  });

  it('auto-closes unfinished citation tags at finish', () => {
    const stripped = stripMemoryCitations('x<oai-mem-citation>source');

    expect(stripped.visibleText).toBe('x');
    expect(stripped.citationBodies).toEqual(['source']);
  });

  it('preserves partial open tags at finish when they never become a full tag', () => {
    const stripped = stripMemoryCitations('hello <oai-mem-');

    expect(stripped.visibleText).toBe('hello <oai-mem-');
    expect(stripped.citationBodies).toEqual([]);
  });

  it('parses entries and deduplicated rollout ids', () => {
    const parsed = parseMemoryCitationBodies([
      [
        '<citation_entries>',
        'MEMORY.md:1-2|note=[summary]',
        'rollout_summaries/foo.md:10-12|note=[details]',
        '</citation_entries>',
        '<rollout_ids>',
        'thread_a',
        'thread_b',
        'thread_a',
        '</rollout_ids>',
      ].join('\n'),
    ]);

    expect(parsed).toEqual({
      entries: [
        { path: 'MEMORY.md', lineStart: 1, lineEnd: 2, note: 'summary' },
        { path: 'rollout_summaries/foo.md', lineStart: 10, lineEnd: 12, note: 'details' },
      ],
      rolloutIds: ['thread_a', 'thread_b'],
    });
  });

  it('accepts legacy thread_ids blocks', () => {
    expect(parseMemoryCitationBodies(['<thread_ids>\nthread_1\n</thread_ids>'])).toEqual({
      entries: [],
      rolloutIds: ['thread_1'],
    });
  });
});
