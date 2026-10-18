import type { RuntimeMessage } from '../../src/threads.js';
import { expect, it } from 'vitest';
import { resolveMessageDeletionIds } from '../../src/threads/message-deletion.js';

it.each(['long_turn', undefined])('expands a tail-page selection to the full exchange (turnId: %s)', (turnId) => {
  const target: RuntimeMessage[] = Array.from({ length: 430 }, (_, index) => message(`target_${index}`, index === 0 ? 'user' : index % 3 ? 'assistant' : 'tool', turnId));
  const before = [message('before_prompt', 'user', 'before'), message('before_answer', 'assistant', 'before')];
  const after = [message('after_prompt', 'user', 'after'), message('after_answer', 'assistant', 'after')];
  const messages = [...before, ...target, ...after];
  const original = structuredClone(messages);
  expect(resolveMessageDeletionIds(messages, { messageIds: target.slice(-160).map((item) => item.id), scope: 'turns' }))
    .toEqual(target.map((item) => item.id));
  expect(resolveMessageDeletionIds(messages, { messageIds: [target[0].id], scope: 'turns' })).toEqual(target.map((item) => item.id));
  expect(messages).toEqual(original);
});

it('keeps exact-ID callers exact and ignores stale selected IDs', () => {
  const messages = [message('question', 'user', 'turn'), message('answer', 'assistant', 'turn')];
  expect(resolveMessageDeletionIds(messages, { messageIds: [' answer ', 'answer', 'missing'] })).toEqual(['answer']);
  expect(resolveMessageDeletionIds(messages, { messageIds: ['answer'], scope: 'messages' })).toEqual(['answer']);
  expect(resolveMessageDeletionIds(messages, { messageIds: ['missing'], scope: 'turns' })).toEqual([]);
});

it('deletes a regenerated answer with its original prompt, steers and hidden records across execution IDs', () => {
  const target = [message('original_prompt', 'user', 'original_turn'),
    ...Array.from({ length: 430 }, (_, index) => message(`replacement_${index}`, 'assistant', 'replacement_turn')),
    message('steer', 'user', 'replacement_turn'),
    { ...message('model_only', 'user', 'replacement_turn'), visibility: 'model' as const },
    message('tool_result', 'tool', 'replacement_turn')];
  const messages = [message('before_prompt', 'user', 'before'), message('before_reply', 'assistant', 'before'),
    ...target, message('after_prompt', 'user', 'after'), message('after_reply', 'assistant', 'after')];
  const original = structuredClone(messages);
  for (const messageIds of [target.slice(-160).map((item) => item.id), ['original_prompt']]) {
    expect(resolveMessageDeletionIds(messages, { messageIds, scope: 'turns' })).toEqual(target.map((item) => item.id));
  }
  expect(messages).toEqual(original);
});

it('keeps unrelated assistant-only turns separate when there is no visible question', () => {
  const messages = [message('first', 'assistant', 'first_turn'), message('second', 'assistant', 'second_turn')];
  expect(resolveMessageDeletionIds(messages, { messageIds: ['second'], scope: 'turns' })).toEqual(['second']);
});

it('binds a legacy prompt and early response to tagged work, steers and model-only records', () => {
  const target = [message('question', 'user'), message('early', 'assistant'), message('reply', 'assistant', 'turn'),
    message('steer', 'user', 'turn'), { ...message('model', 'user', 'turn'), visibility: 'model' as const },
    message('tool', 'tool'), message('tail', 'assistant')];
  const messages = [message('system', 'system'), ...target, message('next', 'user', 'next'), message('other', 'assistant', 'next')];
  expect(resolveMessageDeletionIds(messages, { messageIds: ['tail'], scope: 'turns' })).toEqual(target.map((item) => item.id));
});

it('keeps legacy exchanges intact across an anchored compaction and supports nonadjacent selections', () => {
  const notice: RuntimeMessage = { ...message('notice', 'user'), contextCompaction: {
    compactedMessageCount: 2, compactedTokens: 100, keptRecentMessageCount: 0, maxContextTokensK: 64,
    originalMessageCount: 2, originalTokens: 100, transcriptAfterMessageId: 'early',
  } };
  const messages = [notice, message('question', 'user'), message('early', 'assistant'), message('tail', 'assistant'),
    message('next_question', 'user'), message('next_reply', 'assistant'), message('last_question', 'user'), message('last_reply', 'assistant')];
  expect(resolveMessageDeletionIds(messages, { messageIds: ['tail', 'last_reply'], scope: 'turns' }))
    .toEqual(['notice', 'question', 'early', 'tail', 'last_question', 'last_reply']);
});

function message(id: string, role: RuntimeMessage['role'], turnId?: string): RuntimeMessage {
  return { id, role, turnId, content: id, createdAt: '', status: 'complete' };
}
