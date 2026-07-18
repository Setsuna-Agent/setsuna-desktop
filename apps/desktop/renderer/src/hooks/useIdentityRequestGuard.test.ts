import { describe, expect, it } from 'vitest';
import { createIdentityRequestGuard } from './useIdentityRequestGuard.js';

describe('createIdentityRequestGuard', () => {
  it('invalidates an old owner before its delayed response can commit', async () => {
    const guard = createIdentityRequestGuard('thread:A');
    const aResponse = deferred<void>();
    const bResponse = deferred<void>();
    const commits: string[] = [];

    const isCurrentA = guard.begin();
    const aTask = aResponse.promise.then(() => {
      if (isCurrentA()) commits.push('A');
    });

    guard.updateIdentity('thread:B');
    const isCurrentB = guard.begin();
    const bTask = bResponse.promise.then(() => {
      if (isCurrentB()) commits.push('B');
    });

    bResponse.resolve();
    await bTask;
    aResponse.resolve();
    await aTask;

    expect(commits).toEqual(['B']);
  });

  it('lets only the newest request commit within one composer session', () => {
    const guard = createIdentityRequestGuard('new-thread-slot:project');
    const first = guard.begin();
    const second = guard.begin();

    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('does not restore a failed A draft into the newly selected B composer', async () => {
    const guard = createIdentityRequestGuard('thread:A');
    const response = deferred<void>();
    const isCurrentA = guard.begin();
    let visibleDraft = 'draft-B';
    const task = response.promise.catch(() => {
      if (isCurrentA()) visibleDraft = 'draft-A';
    });

    guard.updateIdentity('thread:B');
    response.reject(new Error('A failed'));
    await task;

    expect(visibleDraft).toBe('draft-B');
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}
