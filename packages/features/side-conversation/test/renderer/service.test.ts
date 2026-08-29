import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import { sideConversationFeature } from '../../src/contracts/index.js';
import { RendererSideConversationService } from '../../src/renderer/service.js';

describe('RendererSideConversationService', () => {
  it('deletes a delayed snapshot before it reaches the send pipeline when its owner changes', async () => {
    const created = deferred<{ threadId: string }>();
    const client = {
      create: vi.fn(async () => created.promise),
    };
    const host = {
      getThread: vi.fn(async () => thread('thread_side_a')),
      deleteThread: vi.fn(async () => undefined),
    };
    const scope = createFeatureScope({
      featureId: sideConversationFeature.id,
      process: 'renderer',
      scopeId: 'renderer:side-conversation:test',
    });
    const service = new RendererSideConversationService({ client, host, scope: scope.scope });
    scope.activate();
    let currentOwner = true;

    const creation = service.create('thread_a', () => currentOwner);
    currentOwner = false;
    created.resolve({ threadId: 'thread_side_a' });

    await expect(creation).rejects.toThrow('owner changed');
    expect(host.getThread).not.toHaveBeenCalled();
    expect(host.deleteThread).toHaveBeenCalledWith('thread_side_a');
    await scope.finishDispose();
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
