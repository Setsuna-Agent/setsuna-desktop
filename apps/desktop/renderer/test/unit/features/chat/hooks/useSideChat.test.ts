import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createSideConversationForOwner } from '../../../../../src/features/chat/hooks/useSideChat.js';
import { createIdentityRequestGuard } from '../../../../../src/shared/hooks/useIdentityRequestGuard.js';

describe('side conversation ownership', () => {
  it('deletes a delayed snapshot and prevents it from reaching the send pipeline after its owner changes', async () => {
    const created = deferred<RuntimeThread>();
    const client = {
      createSideConversation: vi.fn(async () => created.promise),
      deleteThread: vi.fn(async () => undefined),
    };
    const owner = createIdentityRequestGuard('parent:thread_a');
    const creation = createSideConversationForOwner(client, 'thread_a', owner.begin());

    owner.updateIdentity('parent:thread_b');
    created.resolve(thread('thread_side_a'));

    await expect(creation).rejects.toThrow('owner changed');
    expect(client.deleteThread).toHaveBeenCalledWith('thread_side_a');
  });
});

function thread(id: string): RuntimeThread {
  return {
    id,
    kind: 'side',
    title: 'Side conversation',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    lastSeq: 0,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
