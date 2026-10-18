import { applyRuntimeEventToThread, type RuntimeMessage, type RuntimeThread } from '@setsuna-desktop/contracts';
import path from 'node:path';
import { expect, it } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { createOpenAiCaptureServer, withTimeout } from '../../support/runtime-server/shared.js';

it.each(['long_turn', undefined])('deletes the whole 430-record exchange selected from its tail and keeps context deleted after restart (turnId: %s)', async (turnId) => {
  const harness = await createRuntimeServerTestHarness();
  const capture = await createOpenAiCaptureServer();
  try {
    const threadId = await seed(harness, turnId);
    const page: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}?messageLimit=160`);
    expect(page.messages).toHaveLength(160);
    expect(page.messages.some((message) => message.id === 'target_0')).toBe(false);
    const selected = page.messages.filter((message) => message.id.startsWith('target_')).map((message) => message.id);
    const result: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}/messages`, {
      method: 'DELETE', body: JSON.stringify({ messageIds: selected, scope: 'turns' }),
    });
    expect(result.messages).toHaveLength(160);
    expect(result.messagePage).toEqual({ total: 252, nextBefore: 92 });
    expect(result.messages.some((message) => message.id.startsWith('target_'))).toBe(false);
    const events = await harness.openRuntimeEventStream(threadId, page.lastSeq);
    try {
      expect(await events.readContains('"type":"messages.deleted"')).toBe(true);
      expect(await events.readContains('target_0')).toBe(true);
      expect(await events.readContains('target_429')).toBe(true);
    } finally { await events.close(); }
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const full: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}`);
    expect(full.messages).toHaveLength(252);
    expect(full.messages.some((message) => message.id.startsWith('target_'))).toBe(false);
    expect(full.messages.at(-1)?.id).toBe('after_answer');
    await harness.configureOpenAiProvider('deleted-history', capture.baseUrl);
    const started = await harness.runtimeFetch(`/v1/threads/${threadId}/turns`, { method: 'POST', body: JSON.stringify({ input: 'Continue after deletion' }) });
    const request = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Reading post-deletion model context');
    expect(JSON.stringify(request.messages)).not.toContain('deleted-secret');
    expect(JSON.stringify(request.messages)).toContain('surviving follow-up');
    await harness.waitForCompletedTurn(threadId, started.turnId);
  } finally { await harness.close(); await capture.close(); }
});

it.each(['long_turn', undefined])('publishes a complete truncation list when another window edits before the current page (turnId: %s)', async (turnId) => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const threadId = await seed(harness, turnId);
    const page: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}?messageLimit=160`);
    const started = await harness.runtimeFetch(`/v1/threads/${threadId}/messages/target_0/regenerate`, {
      method: 'POST', body: JSON.stringify({ content: 'Edited original prompt' }),
    });
    await harness.waitForCompletedTurn(threadId, started.turnId);
    await harness.server.close();
    const store = createStore(harness);
    try {
      const events = await store.listEvents(threadId, page.lastSeq);
      const mutation = events.find((event) => event.type === 'messages.truncated');
      expect(mutation?.type).toBe('messages.truncated');
      if (mutation?.type !== 'messages.truncated') throw new Error('Missing persisted truncation');
      expect(mutation.payload.removedMessageIds).toHaveLength(431);
      expect(mutation.payload.removedMessageIds).toContain('target_1');
      expect(applyRuntimeEventToThread(page, mutation).messages).toEqual([]);
    } finally { await store.close(); }
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const recovered: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}?messageLimit=160`);
    expect(recovered.messages.some((message) => message.content === 'Edited original prompt')).toBe(true);
    expect(recovered.messages.some((message) => message.id === 'target_429' || message.id === 'after_answer')).toBe(false);
    expect(await harness.runtimeFetch(`/v1/threads/${threadId}?messageLimit=160&knownSeq=${recovered.lastSeq}&knownActiveTurnId=`)).toBeNull();
  } finally { await harness.close(); }
});

it('deletes the original prompt with a twice-regenerated long answer and excludes both from subsequent model context', async () => {
  const harness = await createRuntimeServerTestHarness();
  const capture = await createOpenAiCaptureServer();
  try {
    const threadId = await seed(harness, 'original_turn');
    let replacementTurnId = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const started = await harness.runtimeFetch(`/v1/threads/${threadId}/messages/target_0/regenerate`, {
        method: 'POST', body: JSON.stringify({ content: 'deleted-secret regenerated prompt' }),
      });
      replacementTurnId = started.turnId;
      const completed = await harness.waitForCompletedTurn(threadId, replacementTurnId);
      expect(replacementTurnId).not.toBe('original_turn');
      expect(completed.messages.find((item) => item.id === 'target_0')?.turnId).toBe('original_turn');
    }
    await harness.server.close();
    const store = createStore(harness);
    try {
      const messages = [
        ...Array.from({ length: 430 }, (_, index) => message(`replacement_${index}`, 'assistant', replacementTurnId, 'deleted-secret replacement fragment')),
        message('retained_prompt', 'user', 'after', 'surviving follow-up'),
        message('retained_answer', 'assistant', 'after', 'surviving follow-up answer'),
      ];
      await store.appendEvents(threadId, messages.map((item) => ({ id: `event_${item.id}`, threadId, turnId: item.turnId,
        createdAt: item.createdAt, type: 'message.created' as const, payload: { message: item },
      })));
    } finally { await store.close(); }
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const page: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}?messageLimit=160`);
    expect(page.messages).toHaveLength(160);
    expect(page.messages.some((item) => item.id === 'target_0')).toBe(false);
    const result: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}/messages`, {
      method: 'DELETE', body: JSON.stringify({ scope: 'turns', messageIds: page.messages
        .filter((item) => item.turnId === replacementTurnId).map((item) => item.id) }),
    });
    expect(result.messagePage).toEqual({ total: 252, nextBefore: 92 });
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const reopened: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}`);
    expect(reopened.messages).toHaveLength(252);
    expect(reopened.messages.some((item) => item.id === 'target_0' || item.turnId === replacementTurnId)).toBe(false);
    await harness.configureOpenAiProvider('regenerated-history', capture.baseUrl);
    const started = await harness.runtimeFetch(`/v1/threads/${threadId}/turns`, { method: 'POST', body: JSON.stringify({
      input: 'Continue after deletion', modelSelection: { providerId: 'regenerated-history', modelId: 'regenerated-history-model' },
    }) });
    const request = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Reading context after regenerated answer deletion');
    expect(JSON.stringify(request.messages)).not.toContain('deleted-secret');
    expect(JSON.stringify(request.messages)).toContain('surviving follow-up');
    await harness.waitForCompletedTurn(threadId, started.turnId);
  } finally { await harness.close(); await capture.close(); }
});

async function seed(harness: RuntimeServerTestHarness, turnId?: string): Promise<string> {
  await harness.server.close();
  const store = createStore(harness);
  let threadId: string;
  try {
    const thread = await store.createThread({ title: 'Large paged history mutation' });
    threadId = thread.id;
    const messages: RuntimeMessage[] = [
      ...Array.from({ length: 250 }, (_, index) => message(`before_${index}`, index === 0 ? 'user' : 'assistant', 'before', 'retained prefix')),
      ...Array.from({ length: 430 }, (_, index) => message(`target_${index}`, index === 0 ? 'user' : index % 3 ? 'assistant' : 'tool', turnId, 'deleted-secret')),
      message('after_prompt', 'user', 'after', 'surviving follow-up'), message('after_answer', 'assistant', 'after', 'surviving follow-up answer'),
    ];
    await store.appendEvents(threadId, messages.map((item) => ({ id: `event_${item.id}`, threadId, turnId: item.turnId,
      createdAt: item.createdAt, type: 'message.created' as const, payload: { message: item },
    })));
  } finally { await store.close(); }
  await harness.startRuntimeServer(harness.runtimeDataDir);
  return threadId!;
}
function createStore(harness: RuntimeServerTestHarness) {
  return new SqliteThreadStore(path.join(harness.runtimeDataDir, 'runtime'), systemClock, new RandomIdGenerator());
}
function message(id: string, role: RuntimeMessage['role'], turnId: string | undefined, content: string): RuntimeMessage {
  return { id, role, turnId, content, status: 'complete', phase: role === 'assistant' ? 'final_answer' : undefined, createdAt: '2026-10-18T00:00:00Z' };
}
