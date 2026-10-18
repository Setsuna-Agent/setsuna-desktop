import { expect, it } from 'vitest';
import { applyRuntimeEventToThread } from '../../src/thread-events.js';
import type { RuntimeMessage, RuntimeThread, RuntimeToolRun } from '../../src/threads.js';
import { messageFileChangeGroupId, projectMessagePageFileChanges } from '../../src/workspace/file-change-groups.js';

it('indexes full turns using small metadata, excluding other turns and failed operations', () => {
  const run: RuntimeToolRun = {
    id: 'early', name: 'edit', status: 'success', argumentsPreview: 'secret arguments',
    resultPreview: '{invalid legacy preview', data: { diff: {
      type: 'file_diff', path: 'early.ts', absolutePath: '/repo/early.ts', action: 'Edited', additions: 2, deletions: 1,
      lines: [{ type: 'add', content: 'x'.repeat(1_000_000) }], undo: { text: 'private undo body' },
    } },
  };
  const messages = [message('early', 'turn', [run]), message('foreign', 'other', [run]),
    message('failed', 'turn', [{ ...run, id: 'failed', status: 'error' }]), message('tail', 'turn', [])];
  const groups = projectPage(messages, messages.slice(-1)).fileChangeGroups!;
  expect(Object.keys(groups)).toEqual(['turn']);
  expect(groups.turn).toHaveLength(1);
  expect(groups.turn[0]).toMatchObject({ messageId: 'early', run: { id: 'early', data: { diff: {
    path: 'early.ts', absolutePath: '/repo/early.ts', additions: 2, deletions: 1, lines: [], truncated: true,
  } } } });
  expect(JSON.stringify(groups).length).toBeLessThan(400);
  expect(groups.turn[0].run).not.toHaveProperty('resultPreview');
  expect(groups.turn[0].run.data).not.toHaveProperty('diff.undo');
  expect(projectPage(messages, messages.slice(-1)).fileChangeGroups!.turn[0].run).toBe(groups.turn[0].run);
});

it('supports legacy preview-only patches and prunes operation identities when messages are removed', () => {
  const messages = [message('early', 'turn', [{ id: 'patch', name: 'apply_patch', status: 'success',
    resultPreview: JSON.stringify({ diff: { diffs: [{ path: 'a.ts', additions: 1 }, { path: 'b.ts', deletions: 2 }] } }),
  }]), message('tail', 'turn', [])];
  const groups = projectPage(messages, messages.slice(-1)).fileChangeGroups!;
  expect(groups.turn[0].run.data).toMatchObject({ diff: { diffs: [{ path: 'a.ts' }, { path: 'b.ts' }] } });
  const thread: RuntimeThread = { id: 'thread', title: '', createdAt: '', updatedAt: '', archived: false,
    messageCount: 2, lastMessagePreview: '', lastSeq: 1, messages: messages.slice(-1), fileChangeGroups: groups,
  };
  const removed = applyRuntimeEventToThread(thread, { id: 'delete', threadId: 'thread', seq: 2, createdAt: '',
    type: 'messages.deleted', payload: { messageIds: ['early'] },
  });
  expect(removed.fileChangeGroups?.turn).toEqual([]);
  expect(groups.turn).toHaveLength(1);
});

it('keeps legacy operation scopes stable across pages without mixing separate user turns', () => {
  const messages: RuntimeMessage[] = [
    { ...message('prompt_1', undefined, []), role: 'user' },
    editMessage('early_1'),
    { ...editMessage('hidden'), visibility: 'model' },
    { ...message('tool_result', undefined, []), role: 'tool' },
    message('tail_1', undefined, []),
    { ...message('prompt_2', undefined, []), role: 'user' },
    editMessage('early_2'),
    message('tail_2', undefined, []),
    { ...message('prompt_3', undefined, []), role: 'user' },
    message('modern', 'modern_turn', [editMessage('modern_edit').toolRuns![0]]),
  ];
  const original = structuredClone(messages);
  const earlier = projectPage(messages, messages.slice(1, 5));
  const later = projectPage(messages, [messages[4], messages[7]]);
  const firstGroup = messageFileChangeGroupId(later.messages[0])!;
  const secondGroup = messageFileChangeGroupId(later.messages[1])!;
  expect(firstGroup).toBe(messageFileChangeGroupId(earlier.messages[0]));
  expect(firstGroup).not.toBe(secondGroup);
  expect(Object.keys(later.fileChangeGroups!)).toEqual([firstGroup, secondGroup]);
  expect(later.fileChangeGroups![firstGroup].map(({ run }) => run.id)).toEqual(['early_1']);
  expect(later.fileChangeGroups![secondGroup].map(({ run }) => run.id)).toEqual(['early_2']);
  expect(later.messages.every((message) => !message.turnId)).toBe(true);
  expect(messages).toEqual(original);
});

it('joins missing turn IDs with the known turn in the same assistant run', () => {
  const messages = [editMessage('early'), message('known', 'turn', []),
    { ...message('steer', 'turn', []), role: 'user' as const }, editMessage('late'), message('tail', undefined, [])];
  for (const visible of [[messages[1]], [messages[4]]]) {
    const page = projectPage(messages, visible);
    expect(messageFileChangeGroupId(page.messages[0])).toBe('turn');
    expect(page.fileChangeGroups!.turn.map(({ run }) => run.id)).toEqual(['early', 'late']);
  }
});

it('uses the timeline anchor of manual compaction as a legacy run boundary', () => {
  const messages: RuntimeMessage[] = [
    { ...message('summary', undefined, []), role: 'user', contextCompaction: {
      compactedMessageCount: 1, compactedTokens: 128, keptRecentMessageCount: 1,
      maxContextTokensK: 256, originalMessageCount: 2, originalTokens: 512,
      transcriptAfterMessageId: 'before_tail',
    } },
    editMessage('before'), message('before_tail', undefined, []), editMessage('after'), message('after_tail', undefined, []),
  ];
  const page = projectPage(messages, [messages[2], messages[4]]);
  expect(page.messages.map(messageFileChangeGroupId)).toEqual(['legacy:before', 'legacy:after']);
  expect(page.fileChangeGroups!['legacy:before'].map(({ run }) => run.id)).toEqual(['before']);
  expect(page.fileChangeGroups!['legacy:after'].map(({ run }) => run.id)).toEqual(['after']);
});

function editMessage(id: string): RuntimeMessage {
  return message(id, undefined, [{ id, name: 'edit', status: 'success',
    data: { diff: { path: `${id}.ts`, additions: 1, deletions: 0 } },
  }]);
}

function projectPage(messages: RuntimeMessage[], visible: RuntimeMessage[]) {
  return projectMessagePageFileChanges(messages, { messages: visible, nextBefore: null, total: messages.length });
}

function message(id: string, turnId: string | undefined, toolRuns: RuntimeToolRun[]): RuntimeMessage {
  return { id, turnId, toolRuns, role: 'assistant', content: '', createdAt: '' };
}
