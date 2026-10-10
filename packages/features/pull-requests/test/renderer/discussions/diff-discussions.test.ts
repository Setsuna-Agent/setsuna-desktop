import { describe, expect, it } from 'vitest';
import { discussion } from '../../../src/contracts/models.js';
import { partitionDiffDiscussions } from '../../../src/renderer/discussions/diff-discussions.js';

const thread = (id: string, line: number | null, side: 'LEFT' | 'RIGHT' | null, outdated = false) => discussion({
  id, kind: 'thread', state: null, resolved: false, outdated, canReply: true,
  path: 'a.ts', line, side, diffHunk: null, commitSha: null, comments: [], replyCursor: null,
});

describe('PR discussion locations', () => {
  it('groups only exact visible sides and retains every outdated, hidden and file-level thread', () => {
    const threads = [thread('left', 10, 'LEFT'), thread('right', 20, 'RIGHT'), thread('reply', 20, 'RIGHT'),
      thread('wrongSide', 20, 'LEFT'), thread('hidden', 50, 'RIGHT'), thread('old', 20, 'RIGHT', true),
      thread('file', null, null), thread('deleted', 40, 'LEFT'), thread('empty', 41, 'RIGHT')];
    const patch = '@@ -10,2 +20,2 @@\n a\n-b\n+c\n@@ -40 +41,0 @@\n-x';
    const result = partitionDiffDiscussions(threads, patch);
    expect(result.inline.map((group) => [group.side, group.line, group.discussions.map((item) => item.id)]))
      .toEqual([['LEFT', 10, ['left']], ['RIGHT', 20, ['right', 'reply']], ['LEFT', 40, ['deleted']]]);
    expect(result.detached.map((item) => item.id)).toEqual(['wrongSide', 'hidden', 'old', 'file', 'empty']);
    expect(partitionDiffDiscussions(threads, '').detached).toEqual(threads);
  });
});
