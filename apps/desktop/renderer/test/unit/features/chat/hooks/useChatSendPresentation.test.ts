// @vitest-environment happy-dom

import type { RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChatSendPresentation } from '../../../../../src/features/chat/hooks/useChatSendPresentation.js';

afterEach(cleanup);

type Input = Parameters<typeof useChatSendPresentation>[0];

describe('chat submission presentation', () => {
  it('exposes the submitted message immediately and keeps it until the durable echo arrives', async () => {
    const response = deferred<boolean>();
    const onSend = vi.fn(() => response.promise);
    const input = initialInput(onSend);
    const view = renderHook(useChatSendPresentation, { initialProps: input });
    const attachments = [{ id: 'asset', assetId: 'asset', source: 'runtime' as const, name: 'note.txt', type: 'text/plain', size: 12 }];
    const skillReferences = [{ skillId: 'review', start: 0, end: 6 }];
    let send!: Promise<boolean>;
    act(() => { send = view.result.current.sendInput(undefined, { attachments, skillReferences }); });
    const pending = view.result.current.pendingMessages[0];
    expect(pending).toMatchObject({ role: 'user', content: 'Review project', attachments, skillReferences });
    expect(view.result.current.submitting).toBe(true);
    expect(input.messages).toEqual([]);
    expect(onSend).toHaveBeenCalledWith(undefined, expect.objectContaining({ clientId: pending.clientId }));

    await act(async () => { response.resolve(true); expect(await send).toBe(true); });
    expect(view.result.current.submitting).toBe(false);
    expect(view.result.current.pendingMessages).toEqual([pending]);
    const echoed = { ...pending, id: 'persisted', turnId: 'turn' };
    view.rerender({ ...input, messages: [echoed] });
    expect(view.result.current.pendingMessages).toEqual([]);
  });

  it('reconciles an event arriving before the response without unlocking an in-flight submission', async () => {
    const response = deferred<boolean>();
    const input = initialInput(() => response.promise);
    const view = renderHook(useChatSendPresentation, { initialProps: input });
    let send!: Promise<boolean>;
    act(() => { send = view.result.current.sendInput(); });
    const pending = view.result.current.pendingMessages[0];
    view.rerender({ ...input, messages: [{ ...pending, id: 'persisted' }] });
    expect(view.result.current.pendingMessages).toEqual([]);
    expect(view.result.current.submitting).toBe(true);
    view.rerender(input);
    expect(view.result.current.pendingMessages).toEqual([]);
    await act(async () => { response.resolve(true); await send; });
    expect(view.result.current.submitting).toBe(false);
    // A later deletion must not resurrect a previously reconciled pending message.
    view.rerender(input);
    expect(view.result.current.pendingMessages).toEqual([]);
  });

  it.each(['rejected', 'error'] as const)('removes a failed %s submission', async (outcome) => {
    const response = deferred<boolean>();
    const view = renderHook(useChatSendPresentation, { initialProps: initialInput(() => response.promise) });
    let send!: Promise<boolean>;
    act(() => { send = view.result.current.sendInput(); });
    expect(view.result.current.pendingMessages).toHaveLength(1);
    await act(async () => {
      if (outcome === 'error') {
        const rejected = expect(send).rejects.toThrow('Unavailable');
        response.reject(new Error('Unavailable'));
        await rejected;
      } else {
        response.resolve(false);
        expect(await send).toBe(false);
      }
    });
    expect(view.result.current.pendingMessages).toEqual([]);
    expect(view.result.current.submitting).toBe(false);
  });

  it('settles delayed responses in their originating composer while another composer is sending', async () => {
    const responseA = deferred<boolean>();
    const responseB = deferred<boolean>();
    const inputA = initialInput(() => responseA.promise);
    const inputB = { ...inputA, composerKey: 'composer:B', draft: 'B input', onSend: () => responseB.promise };
    const view = renderHook(useChatSendPresentation, { initialProps: inputA });
    let sendA!: Promise<boolean>;
    let sendB!: Promise<boolean>;
    act(() => { sendA = view.result.current.sendInput(); });
    view.rerender(inputB);
    expect(view.result.current.pendingMessages).toEqual([]);
    expect(view.result.current.submitting).toBe(false);
    act(() => { sendB = view.result.current.sendInput(); });
    await act(async () => { responseA.resolve(false); await sendA; });
    expect(view.result.current.pendingMessages).toMatchObject([{ content: 'B input' }]);
    expect(view.result.current.submitting).toBe(true);
    await act(async () => { responseB.resolve(true); await sendB; });
    view.rerender(inputA);
    expect(view.result.current.pendingMessages).toEqual([]);
    expect(view.result.current.submitting).toBe(false);
  });

  it.each(['active', 'goal'] as const)('keeps %s queue inputs out of the message projection', async (kind) => {
    const response = deferred<boolean>();
    const view = renderHook(useChatSendPresentation, { initialProps: {
      ...initialInput(() => response.promise), activeTurnId: kind === 'active' ? 'turn' : null,
    } });
    let send!: Promise<boolean>;
    act(() => { send = view.result.current.sendInput(undefined, { goalMode: kind === 'goal' }); });
    expect(view.result.current.pendingMessages).toEqual([]);
    expect(view.result.current.submitting).toBe(true);
    await act(async () => { response.resolve(true); await send; });
    expect(view.result.current.submitting).toBe(false);
  });

  it('retires a message when a concurrent runtime turn routes it into the durable queue', async () => {
    const response = deferred<boolean>();
    const input = initialInput(() => response.promise);
    const view = renderHook(useChatSendPresentation, { initialProps: input });
    let send!: Promise<boolean>;
    act(() => { send = view.result.current.sendInput(); });
    const pending = view.result.current.pendingMessages[0];
    const currentThread: RuntimeThread = {
      id: 'thread', title: '', archived: false, lastSeq: 1, messageCount: 0, lastMessagePreview: '',
      createdAt: '', updatedAt: '', messages: [], queuedTurnInputs: [{
        id: 'queued', clientId: pending.clientId, input: pending.content, createdAt: pending.createdAt,
      }],
    };
    view.rerender({ ...input, currentThread });
    expect(view.result.current.pendingMessages).toEqual([]);
    await act(async () => { response.resolve(true); await send; });
    expect(view.result.current.submitting).toBe(false);
  });
});

function initialInput(onSend: Input['onSend']): Input {
  return { activeTurnId: null, composerKey: 'composer:A', currentThread: null, draft: 'Review project', messages: [] as RuntimeMessage[], onSend };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
