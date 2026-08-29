import type {
  RuntimeMessageAttachment,
  RuntimeThread,
  RuntimeThreadSummary,
} from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import type { RuntimeRouteRegistrar } from '@setsuna-desktop/feature-core/runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  createSideConversation,
  sideConversationFeature,
  type SideConversationRuntimeHost,
} from '../../src/contracts/index.js';
import { sideConversationRuntimeFeature } from '../../src/runtime/feature.js';
import { createRuntimeSideConversation } from '../../src/runtime/side-conversation-service.js';

describe('createRuntimeSideConversation', () => {
  it('does not create a child when the request is already cancelled', async () => {
    const parent = thread('thread_parent');
    const child = thread('thread_side', { forkedFromId: parent.id, kind: 'side' });
    const createThread = vi.fn(async () => child);
    const rollbackCreatedThread = vi.fn(async () => undefined);
    const host = runtimeHost({ parent, child, createThread, rollbackCreatedThread });
    const cancellation = new AbortController();
    cancellation.abort();

    await expect(createRuntimeSideConversation(
      host,
      parent.id,
      { signal: cancellation.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(createThread).not.toHaveBeenCalled();
    expect(rollbackCreatedThread).not.toHaveBeenCalled();
  });

  it('forwards route cancellation and rolls back a child created before it is observed', async () => {
    const parent = thread('thread_parent');
    const child = thread('thread_side', { forkedFromId: parent.id, kind: 'side' });
    const created = deferred<RuntimeThread>();
    const createStarted = deferred<void>();
    const createThread = vi.fn(async () => {
      createStarted.resolve();
      return created.promise;
    });
    const retainAttachments = vi.fn(async () => undefined);
    const rollbackCreatedThread = vi.fn(async () => undefined);
    const host = runtimeHost({
      parent,
      child,
      createThread,
      listThreads: async () => [],
      retainAttachments,
      rollbackCreatedThread,
    });
    const cancellation = new AbortController();
    const routeHandlers = new Map<string, (input: unknown, signal: AbortSignal) => Promise<unknown>>();
    const routes: RuntimeRouteRegistrar = {
      register(scope, operation, handler) {
        routeHandlers.set(operation.id, async (input, signal) => handler(input as never, { signal }));
        const contribution = Object.freeze({
          dispose: () => {
            routeHandlers.delete(operation.id);
          },
        });
        scope.add(contribution.dispose);
        return contribution;
      },
    };
    const scope = createFeatureScope({
      featureId: sideConversationFeature.id,
      process: 'runtime',
      scopeId: 'runtime:side-conversation:cancellation-test',
    });
    await sideConversationRuntimeFeature.setup({
      dependencies: { host, routes },
      health: { setCondition() {} },
      provide() {},
      scope: scope.scope,
    });
    const createRoute = routeHandlers.get(createSideConversation.id);
    if (!createRoute) throw new Error('Side conversation create route was not registered.');

    const creation = createRoute({ parentThreadId: parent.id }, cancellation.signal);
    await createStarted.promise;
    cancellation.abort();
    created.resolve(child);

    await expect(creation).rejects.toMatchObject({ name: 'AbortError' });
    expect(retainAttachments).not.toHaveBeenCalled();
    expect(rollbackCreatedThread).toHaveBeenCalledWith(child.id);
    await scope.finishDispose();
  });

  it('rolls back every retained child resource when snapshot copying fails', async () => {
    const parent = thread('thread_parent');
    const child = thread('thread_side', { forkedFromId: parent.id, kind: 'side' });
    const rollbackCreatedThread = vi.fn(async () => undefined);
    const host = runtimeHost({
      parent,
      child,
      copyMessages: vi.fn(async () => {
        throw new Error('copy failed');
      }),
      rollbackCreatedThread,
    });

    await expect(createRuntimeSideConversation(host, parent.id)).rejects.toThrow('copy failed');
    expect(rollbackCreatedThread).toHaveBeenCalledWith(child.id);
  });
});

function runtimeHost(overrides: Readonly<{
  parent: RuntimeThread;
  child: RuntimeThread;
  createThread?: SideConversationRuntimeHost['createThread'];
  listThreads?: SideConversationRuntimeHost['listThreads'];
  retainAttachments?: SideConversationRuntimeHost['retainAttachments'];
  copyMessages?: SideConversationRuntimeHost['copyMessages'];
  rollbackCreatedThread?: SideConversationRuntimeHost['rollbackCreatedThread'];
}>): SideConversationRuntimeHost {
  let nextId = 0;
  return {
    now: () => new Date('2026-08-18T00:00:00.000Z'),
    id: (prefix) => `${prefix}_${nextId += 1}`,
    flushThread: async () => undefined,
    listThreads: overrides.listThreads
      ?? (async () => [overrides.parent, overrides.child] as RuntimeThreadSummary[]),
    getThread: async (threadId) => {
      if (threadId === overrides.parent.id) return overrides.parent;
      if (threadId === overrides.child.id) return overrides.child;
      return null;
    },
    createThread: overrides.createThread ?? (async () => overrides.child),
    retainAttachments: overrides.retainAttachments
      ?? (async (_threadId: string, _attachments: readonly RuntimeMessageAttachment[]) => undefined),
    appendEvent: async () => undefined,
    copyMessages: overrides.copyMessages ?? (async () => undefined),
    rollbackCreatedThread: overrides.rollbackCreatedThread ?? (async () => undefined),
    deleteThread: async () => undefined,
  };
}

function thread(
  id: string,
  overrides: Partial<RuntimeThread> = {},
): RuntimeThread {
  return {
    id,
    title: 'Thread',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    lastSeq: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
