import type { RuntimeEvent, RuntimeMessage, RuntimeThread, StoredThreadEvent } from '@setsuna-desktop/contracts';
import { provideHostCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRuntimeFeatureHost, type RuntimeFeatureComposition } from '@setsuna-desktop/feature-core/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationsRuntimeHostCapability } from '../../src/contracts/index.js';
import { notificationsRuntimeFeature } from '../../src/runtime/index.js';
import { NativeNotificationClient } from '../../src/runtime/native-client.js';
import { completedTurnNotification, isNotifiableCompletion } from '../../src/runtime/turn-completion.js';

const createdAt = '2026-10-10T08:00:00.000Z';
const completed: Extract<RuntimeEvent, { type: 'turn.completed' }> & { turnId: string } = {
  id: 'event_1', threadId: 'thread_1', turnId: 'turn_1', seq: 5, createdAt,
  type: 'turn.completed', payload: { taskKind: 'regular' },
};
const answer: RuntimeMessage = {
  id: 'answer_1', turnId: 'turn_1', role: 'assistant', createdAt, status: 'complete',
  phase: 'final_answer', content: '已经完成。\n验证通过。',
};
function thread(patch: Partial<RuntimeThread> = {}): RuntimeThread {
  return {
    id: 'thread_1', title: '修复通知', createdAt, updatedAt: createdAt, archived: false,
    messageCount: 1, lastMessagePreview: '', lastSeq: 5,
    messages: [answer], turns: [{ id: 'turn_1', status: 'completed', items: [] }], ...patch,
  };
}

const compositions: RuntimeFeatureComposition[] = [];
afterEach(async () => {
  for (const composition of compositions.splice(0)) await composition.dispose();
  vi.restoreAllMocks();
});

async function activate() {
  const client = new NativeNotificationClient('http://127.0.0.1', 'test-token');
  vi.spyOn(NativeNotificationClient, 'fromEnvironment').mockReturnValue(client);
  const send = vi.spyOn(client, 'send').mockImplementation(async (input) => ({ id: input.id, systemNotification: 'shown' }));
  const listeners = new Set<(event: StoredThreadEvent) => void>();
  const getThread = vi.fn(async () => thread());
  const started = performance.now();
  const composition = await defineRuntimeFeatureHost({ required: [], optional: [notificationsRuntimeFeature] }).activate({
    hostCapabilities: [provideHostCapability(notificationsRuntimeHostCapability, {
      getThread,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    })],
  });
  compositions.push(composition);
  return {
    composition, getThread, send, listeners, activationMs: performance.now() - started,
    publish: (event: StoredThreadEvent) => { for (const listener of listeners) listener(event); },
  };
}

describe('automatic turn completion notifications', () => {
  it('uses only the completed turn’s visible final answer, and truncates without breaking emoji', () => {
    const later: RuntimeMessage = { ...answer, id: 'later', turnId: 'turn_2', content: '另一轮回答' };
    const source = thread({ messages: [
      { ...answer, phase: 'commentary', content: '正在处理' }, answer,
      { ...answer, visibility: 'model', content: '隐藏内容' }, later,
    ] });
    expect(completedTurnNotification(completed, source)).toEqual({
      id: 'turn-completed:thread_1:turn_1', threadId: 'thread_1', title: '修复通知',
      body: '已经完成。 验证通过。', onlyWhenBackground: true,
    });
    const body = completedTurnNotification(completed, thread({
      messages: [{ ...answer, content: `${'好'.repeat(155)}👨‍👩‍👧‍👦最后一句` }],
    }))!.body;
    expect(body).toBe(`${'好'.repeat(155)}…`);
    expect(completedTurnNotification(completed, thread({ messages: [{ ...answer, phase: 'commentary' }] }))).toBeNull();
    expect(completedTurnNotification(completed, thread({ messages: [{ ...answer, content: ' ' }] }))).toBeNull();
  });

  it('ignores internal jobs, failed/cancelled turns, deleted threads and child conversations', () => {
    for (const taskKind of ['compact', 'user_shell', 'subagent'] as const) {
      expect(isNotifiableCompletion({ ...completed, payload: { taskKind } })).toBe(false);
    }
    expect(isNotifiableCompletion({ ...completed, type: 'turn.cancelled', payload: {} })).toBe(false);
    expect(isNotifiableCompletion({ ...completed, type: 'runtime.error', payload: { message: 'failed' } })).toBe(false);
    for (const status of ['failed', 'cancelled', 'in_progress'] as const) {
      expect(completedTurnNotification(completed, thread({ turns: [{ id: 'turn_1', items: [], status }] }))).toBeNull();
    }
    expect(completedTurnNotification(completed, null)).toBeNull();
    expect(completedTurnNotification(completed, thread({ kind: 'side' }))).toBeNull();
    expect(completedTurnNotification(completed, thread({ parentThreadId: 'parent' }))).toBeNull();
  });

  it('starts without reads or delivery, sends live completions independently of renderers, and removes its subscription on disposal', async () => {
    const host = await activate();
    expect(host.getThread).not.toHaveBeenCalled();
    expect(host.send).not.toHaveBeenCalled();
    host.publish({ ...completed, type: 'turn.started', payload: { input: '开始' } });
    expect(host.getThread).not.toHaveBeenCalled();
    host.publish(completed);
    await vi.waitFor(() => expect(host.send).toHaveBeenCalledWith(
      expect.objectContaining({ body: '已经完成。 验证通过。', onlyWhenBackground: true }), expect.any(AbortSignal),
    ));
    await host.composition.dispose();
    expect(host.listeners.size).toBe(0);
    host.publish({ ...completed, turnId: 'late' });
    expect(host.getThread).toHaveBeenCalledOnce();
    console.info(`notifications runtime activation: ${host.activationMs.toFixed(2)} ms; startup reads/sends: 0`);
  });

  it('keeps slow/failed notification delivery out of event publication and cancels it on disposal', async () => {
    const host = await activate();
    let signal: AbortSignal | undefined;
    host.send.mockImplementationOnce((_input, requestSignal) => new Promise((_resolve, reject) => {
      signal = requestSignal;
      requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true });
    }));
    expect(() => host.publish(completed)).not.toThrow();
    await vi.waitFor(() => expect(signal).toBeDefined());
    await host.composition.dispose();
    expect(signal!.aborted).toBe(true);

    const retryHost = await activate();
    retryHost.send.mockRejectedValueOnce(new Error('Notification permission denied'));
    expect(() => retryHost.publish(completed)).not.toThrow();
    await vi.waitFor(() => expect(retryHost.send).toHaveBeenCalledOnce());
    retryHost.publish(completed);
    await vi.waitFor(() => expect(retryHost.send).toHaveBeenCalledTimes(2));
  });

  it('does not send a delayed completion after shutdown while the source thread is being read', async () => {
    const host = await activate();
    let resolveThread!: (value: RuntimeThread) => void;
    host.getThread.mockReturnValueOnce(new Promise((resolve) => { resolveThread = resolve; }));
    host.publish(completed);
    const disposal = host.composition.dispose();
    resolveThread(thread());
    await disposal;
    expect(host.send).not.toHaveBeenCalled();
  });
});
