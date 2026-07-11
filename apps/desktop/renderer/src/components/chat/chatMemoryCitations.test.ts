import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { memoryCitationEntriesFromMessages } from './chatMemoryCitations.js';

describe('memoryCitationEntriesFromMessages', () => {
  it('collects citations from all assistant segments and removes duplicate locations', () => {
    const duplicate = { path: 'MEMORY.md', lineStart: 4, lineEnd: 6, note: 'Project preference' };
    const messages: RuntimeMessage[] = [
      assistantMessage('one', [duplicate]),
      assistantMessage('two', [duplicate, { path: 'project/MEMORY.md', lineStart: 9, lineEnd: 9, note: 'Build command' }]),
    ];

    expect(memoryCitationEntriesFromMessages(messages)).toEqual([
      duplicate,
      { path: 'project/MEMORY.md', lineStart: 9, lineEnd: 9, note: 'Build command' },
    ]);
  });

  it('returns an empty list when the answer did not use memory', () => {
    expect(memoryCitationEntriesFromMessages([assistantMessage('one', [])])).toEqual([]);
  });
});

function assistantMessage(id: string, entries: NonNullable<RuntimeMessage['memoryCitation']>['entries']): RuntimeMessage {
  return {
    id,
    role: 'assistant',
    content: 'answer',
    createdAt: '2026-07-11T00:00:00.000Z',
    status: 'complete',
    ...(entries.length ? { memoryCitation: { entries, rolloutIds: [] } } : {}),
  };
}
