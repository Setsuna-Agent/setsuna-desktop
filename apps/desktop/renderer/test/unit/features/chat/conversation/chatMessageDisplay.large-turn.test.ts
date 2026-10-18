import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { projectMessagePageFileChanges } from '@setsuna-desktop/contracts';
import { expect, it } from 'vitest';
import { buildChatTranscript, chatDisplayItemRenderKey, createChatRenderWindow } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';
import { fileChangeRunsForMessages, fileChangeSummaryFromRuns, fileChangeToolCallIds } from '../../../../../src/features/chat/tool-runs/runtimeFileChanges.js';
import { fileRun } from '../tool-runs/RuntimeToolRuns.support.js';

it('windows an oversized active turn and restores every segment when history is requested', () => {
  const messages: RuntimeMessage[] = Array.from({ length: 430 }, (_, index) => ({
    id: `message_${index}`, turnId: 'long_turn', role: index === 0 ? 'user' : 'assistant',
    content: `Progress ${index}`, createdAt: '', phase: 'commentary',
  }));
  const items = buildChatTranscript(messages);
  expect(items).toHaveLength(2);
  const window = createChatRenderWindow(items, { activeTurnId: 'long_turn' });
  const assistant = window.items.find((item) => item.type === 'assistant')!;
  expect(assistant.displaySegments).toHaveLength(160);
  expect(assistant.displaySegments?.at(-1)?.id).toBe('message_429');
  expect(window.hiddenMessageCount).toBe(269);
  expect(createChatRenderWindow(items, { enabled: false }).items).toBe(items);
  const full = items.find((item) => item.type === 'assistant')!;
  expect(full.segments).toHaveLength(429);
  expect(assistant.segments).toBe(full.segments);
  expect(chatDisplayItemRenderKey(assistant)).toBe(chatDisplayItemRenderKey(full));
  const continued = buildChatTranscript([...messages, { ...messages[429], id: 'message_430' }]);
  expect(chatDisplayItemRenderKey(createChatRenderWindow(continued).items[1])).toBe(chatDisplayItemRenderKey(assistant));
  const awaitingApproval = buildChatTranscript(messages.map((message, index) => index === 1 ? {
    ...message, toolRuns: [{ id: 'approval', name: 'delete_file', status: 'pending_approval' }],
  } : message));
  const active = createChatRenderWindow(awaitingApproval).items.find((item) => item.type === 'assistant')!;
  expect(active.displaySegments?.[0].toolRuns?.[0].id).toBe('approval');
  expect(active.displaySegments).toHaveLength(161);
});

it.each(['late.ts', 'early.ts', null])('preserves full file summaries and operation identities across the window (late target: %s)', (latePath) => {
  const messages: RuntimeMessage[] = Array.from({ length: 161 }, (_, index) => ({
    id: `message_${index}`, turnId: 'long_turn', role: 'assistant', content: `Progress ${index}`, createdAt: '',
    toolRuns: index === 0 ? [fileRun('early_edit', 'edit', 'early.ts', 'Edited')]
      : index === 160 && latePath ? [fileRun('late_edit', 'edit', latePath, 'Edited')] : [],
  }));
  const items = buildChatTranscript(messages);
  const assistant = createChatRenderWindow(items).items.find((item) => item.type === 'assistant')!;
  const runs = assistant.segments.flatMap((segment) => segment.toolRuns ?? []);
  expect(assistant.displaySegments).toHaveLength(160);
  expect(assistant.displaySegments?.some((segment) => segment.id === 'message_0')).toBe(false);
  expect(fileChangeSummaryFromRuns(runs)?.files.map((file) => file.path))
    .toEqual(latePath === 'late.ts' ? ['early.ts', 'late.ts'] : ['early.ts']);
  expect(fileChangeToolCallIds(runs)).toEqual(latePath ? ['early_edit', 'late_edit'] : ['early_edit']);
});

it('keeps legacy operation groups separate when the compaction boundary is outside the page', () => {
  const assistant = (id: string, hasEdit = false): RuntimeMessage => ({ id, role: 'assistant', content: '', createdAt: '',
    toolRuns: hasEdit ? [fileRun(id, 'edit', `${id}.ts`, 'Edited')] : [],
  });
  const messages: RuntimeMessage[] = [
    { id: 'summary', role: 'user', content: '', createdAt: '', contextCompaction: {
      compactedMessageCount: 1, compactedTokens: 128, keptRecentMessageCount: 1,
      maxContextTokensK: 256, originalMessageCount: 2, originalTokens: 512, transcriptAfterMessageId: 'before_tail',
    } },
    assistant('before_edit', true), assistant('before_tail'), assistant('after_edit', true), assistant('after_tail'),
  ];
  const page = projectMessagePageFileChanges(messages, { messages: messages.slice(2), total: messages.length, nextBefore: 2 });
  const items = buildChatTranscript(page.messages).filter((item) => item.type === 'assistant');
  expect(items.map((item) => fileChangeToolCallIds(fileChangeRunsForMessages(item.segments, page.fileChangeGroups))))
    .toEqual([['before_edit'], ['after_edit']]);
});

it('does not attach legacy edits after a new prompt to an earlier orphan assistant run', () => {
  const messages: RuntimeMessage[] = [
    { id: 'orphan', turnId: 'first_turn', role: 'assistant' },
    { id: 'steer', turnId: 'first_turn', role: 'user' },
    { id: 'other', turnId: 'other_turn', role: 'assistant', toolRuns: [fileRun('other_edit', 'edit', 'other.ts', 'Edited')] },
    { id: 'prompt', turnId: 'first_turn', role: 'user' },
    { id: 'legacy', role: 'assistant', toolRuns: [fileRun('legacy_edit', 'edit', 'legacy.ts', 'Edited')] },
    { id: 'tail', role: 'assistant' },
  ].map((message) => ({ content: '', createdAt: '', ...message }) as RuntimeMessage);
  const full = buildChatTranscript(messages).filter((item) => item.type === 'assistant').at(-1)!;
  expect(fileChangeToolCallIds(fileChangeRunsForMessages(full.segments))).toEqual(['legacy_edit']);
  const page = projectMessagePageFileChanges(messages, { messages: messages.slice(-1), total: messages.length, nextBefore: 5 });
  const tail = buildChatTranscript(page.messages).find((item) => item.type === 'assistant')!;
  expect(fileChangeToolCallIds(fileChangeRunsForMessages(tail.segments, page.fileChangeGroups))).toEqual(['legacy_edit']);
});
