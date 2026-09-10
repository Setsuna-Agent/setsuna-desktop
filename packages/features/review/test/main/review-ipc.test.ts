import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureScopeUnavailableError } from '@setsuna-desktop/feature-core/status';
import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import type { ReviewCommitMessageGenerator } from '../../src/contracts/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const reviewIpcMocks = vi.hoisted(() => ({
  close: vi.fn(),
  getState: vi.fn(),
  getCommitMessage: vi.fn(),
  getCommitMessageGenerationSource: vi.fn(),
  commit: vi.fn(),
  pull: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  subscribe: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      reviewIpcMocks.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      reviewIpcMocks.handlers.delete(channel);
    }),
  },
}));

vi.mock('../../src/main/change-monitor.js', () => ({
  DesktopReviewChangeMonitor: class {
    readonly close = reviewIpcMocks.close;
    readonly subscribe = reviewIpcMocks.subscribe;
  },
}));

vi.mock('../../src/main/state.js', () => ({
  checkoutReviewBranch: vi.fn(),
  commitReviewChanges: reviewIpcMocks.commit,
  getReviewCommitMessage: reviewIpcMocks.getCommitMessage,
  createAndCheckoutReviewBranch: vi.fn(),
  discardUnstagedReviewFiles: vi.fn(),
  getCommitMessageGenerationSource: reviewIpcMocks.getCommitMessageGenerationSource,
  getDesktopReviewState: reviewIpcMocks.getState,
  pushReviewBranch: vi.fn(),
  pullReviewBranch: reviewIpcMocks.pull,
  stageReviewFiles: vi.fn(),
  unstageReviewFiles: vi.fn(),
}));

import { registerReviewIpc } from '../../src/main/ipc.js';

afterEach(() => {
  reviewIpcMocks.handlers.clear();
  vi.clearAllMocks();
});

describe('review IPC lifecycle', () => {
  it('streams progress only to its requesting renderer and cleans up its lifetime listener', async () => {
    const scope = createFeatureScope({ featureId: 'review', process: 'main', scopeId: 'generation-progress' });
    const sender = new FakeWebContents();
    const send = vi.spyOn(sender, 'send');
    const result = deferred<string>();
    const generate = vi.fn<ReviewCommitMessageGenerator['generate']>(async (_source, options) => {
      options?.onProgress?.('feat: streaming');
      return result.promise;
    });
    reviewIpcMocks.getCommitMessageGenerationSource.mockResolvedValue({ branch: 'main', status: 'M  file.txt', diff: '+updated' });
    scope.scope.add(registerReviewIpc(scope.scope, {
      commitMessages: { generate },
      previews: { createWorkspacePreview: vi.fn(), registerContentPreview: vi.fn(), release: vi.fn() },
      rendererSender: { isAllowed: (id) => id === sender.id },
    }));
    scope.activate();
    try {
      const pending = ipcHandler('desktop-review:generate-commit-message')({ sender }, { workspaceRoot: '/repo', requestId: 'request-1' });
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith('desktop-review:commit-message-progress', { requestId: 'request-1', message: 'feat: streaming' }));
      expect(sender.listenerCount('destroyed')).toBe(1);
      result.resolve('feat: streaming\n\n- Done');
      await expect(pending).resolves.toEqual({ message: 'feat: streaming\n\n- Done' });
      expect(sender.listenerCount('destroyed')).toBe(0);
    } finally {
      result.resolve('done');
      await scope.finishDispose();
    }
  });

  it('routes Git actions and preserves amend targets and sync mode across IPC', async () => {
    const scope = createFeatureScope({ featureId: 'review', process: 'main', scopeId: 'commit-editor-test' });
    const generate = vi.fn();
    const source = { branch: 'main', status: 'M  file.txt', diff: '+updated' };
    reviewIpcMocks.getCommitMessageGenerationSource.mockResolvedValue(source);
    scope.scope.add(registerReviewIpc(scope.scope, {
      commitMessages: { generate },
      previews: { createWorkspacePreview: vi.fn(), registerContentPreview: vi.fn(), release: vi.fn() },
      rendererSender: { isAllowed: (id) => id === 1 },
    }));
    scope.activate();
    const target = { oid: 'a'.repeat(40), branch: 'main' };
    const document = { ...target, message: 'Subject\n\nBody', context: 'On branch main\nChanges to be committed:\n\tmodified: file.txt' };
    reviewIpcMocks.getCommitMessage.mockResolvedValue(document);
    try {
      expect(await ipcHandler('desktop-review:get-commit-message')({ sender: { id: 1 } }, { workspaceRoot: '/repo' })).toEqual(document);
      expect(reviewIpcMocks.getCommitMessage).toHaveBeenCalledWith('/repo');
      const pullResult = { ok: true, pulled: true, state: { workspaceRoot: '/repo' } };
      reviewIpcMocks.pull.mockResolvedValue(pullResult);
      expect(await ipcHandler('desktop-review:pull')({ sender: { id: 1 } }, { workspaceRoot: '/repo' })).toEqual(pullResult);
      await expect(ipcHandler('desktop-review:pull')({ sender: { id: 2 } }, { workspaceRoot: '/repo' })).rejects.toThrow('Desktop renderer is unavailable');
      expect(reviewIpcMocks.pull).toHaveBeenCalledExactlyOnceWith('/repo', { rebase: false });
      for (const rebase of [false, true, 'true']) {
        await ipcHandler('desktop-review:pull')({ sender: { id: 1 } }, { workspaceRoot: '/repo', rebase });
        expect(reviewIpcMocks.pull).toHaveBeenLastCalledWith('/repo', { rebase: rebase === true });
      }
      await ipcHandler('desktop-review:commit')({}, { workspaceRoot: '/repo', message: 'Edited', includeUnstaged: false, amend: target, sync: true });
      expect(reviewIpcMocks.commit).toHaveBeenCalledWith('/repo', { message: 'Edited', includeUnstaged: false, push: false, sync: true, amend: target });
      // Only an explicit boolean true may broaden the default scope at the process boundary.
      for (const value of [undefined, false, true, 'true']) {
        const includeUnstaged = value === true;
        const scopeInput = value === undefined ? {} : { includeUnstaged: value };
        await ipcHandler('desktop-review:commit')({}, { workspaceRoot: '/repo', message: 'Scoped commit', ...scopeInput });
        expect(reviewIpcMocks.commit).toHaveBeenLastCalledWith('/repo', { message: 'Scoped commit', includeUnstaged, push: false, sync: false });
        await ipcHandler('desktop-review:generate-commit-message')({ sender: new FakeWebContents() }, { workspaceRoot: '/repo', ...scopeInput });
        expect(reviewIpcMocks.getCommitMessageGenerationSource).toHaveBeenLastCalledWith('/repo', includeUnstaged);
      }
      const modelSelection = { providerId: 'conversation-provider', modelId: 'conversation-model' };
      await ipcHandler('desktop-review:generate-commit-message')({ sender: new FakeWebContents() }, { workspaceRoot: '/repo', modelSelection });
      expect(generate).toHaveBeenLastCalledWith({ ...source, modelSelection }, { signal: expect.any(AbortSignal) });
      await expect(ipcHandler('desktop-review:generate-commit-message')({ sender: new FakeWebContents() }, {
        workspaceRoot: '/repo', modelSelection: { providerId: 'invalid' },
      })).rejects.toThrow('modelId');
    } finally {
      await scope.finishDispose();
    }
  });

  it('keeps the newest watcher when concurrent subscription requests finish out of order', async () => {
    const firstSubscription = deferred<() => void>();
    const secondSubscription = deferred<() => void>();
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();
    reviewIpcMocks.subscribe
      .mockReturnValueOnce(firstSubscription.promise)
      .mockReturnValueOnce(secondSubscription.promise);
    const sender = new FakeWebContents();
    const scope = createFeatureScope({ featureId: 'review', process: 'main', scopeId: 'review-test' });
    scope.scope.add(registerReviewIpc(scope.scope, {
      commitMessages: { generate: vi.fn() },
      previews: {
        createWorkspacePreview: vi.fn(),
        registerContentPreview: vi.fn(),
        release: vi.fn(),
      },
      rendererSender: { isAllowed: () => true },
    }));
    scope.activate();
    const subscribe = ipcHandler('desktop-review:subscribe-changes');
    const unsubscribe = ipcHandler('desktop-review:unsubscribe-changes');

    const firstRequest = subscribe({ sender: asWebContents(sender) }, { workspaceRoot: '/workspace/first' });
    const secondRequest = subscribe({ sender: asWebContents(sender) }, { workspaceRoot: '/workspace/second' });

    secondSubscription.resolve(disposeSecond);
    const secondSubscriptionId = await secondRequest;
    firstSubscription.resolve(disposeFirst);
    const firstSubscriptionId = await firstRequest;

    expect(typeof secondSubscriptionId).toBe('string');
    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(disposeSecond).not.toHaveBeenCalled();

    // A cancelled preload request unsubscribes its late result. It must not
    // tear down the newer subscription that already won the race.
    unsubscribe({ sender: asWebContents(sender) }, firstSubscriptionId);
    expect(disposeSecond).not.toHaveBeenCalled();

    await scope.finishDispose();
    expect(disposeSecond).toHaveBeenCalledOnce();
    expect(reviewIpcMocks.close).toHaveBeenCalledOnce();
    expect(reviewIpcMocks.handlers.size).toBe(0);
  });

  it('drains an active handler before unregistering Review IPC', async () => {
    const stateResult = deferred<unknown>();
    reviewIpcMocks.getState.mockReturnValue(stateResult.promise);
    const scope = createFeatureScope({ featureId: 'review', process: 'main', scopeId: 'review-drain-test' });
    scope.scope.add(registerReviewIpc(scope.scope, {
      commitMessages: { generate: vi.fn() },
      previews: {
        createWorkspacePreview: vi.fn(),
        registerContentPreview: vi.fn(),
        release: vi.fn(),
      },
      rendererSender: { isAllowed: () => true },
    }));
    scope.activate();
    const getState = ipcHandler('desktop-review:get-state');

    const request = getState({}, { workspaceRoot: '/workspace' });
    const disposal = scope.finishDispose();

    expect(scope.scope.state).toBe('draining');
    expect(reviewIpcMocks.handlers.has('desktop-review:get-state')).toBe(true);
    await expect(getState({}, { workspaceRoot: '/late' })).rejects.toBeInstanceOf(
      FeatureScopeUnavailableError,
    );

    stateResult.resolve({ branch: 'main' });
    await expect(request).resolves.toEqual({ branch: 'main' });
    await disposal;
    expect(reviewIpcMocks.handlers.size).toBe(0);
    expect(reviewIpcMocks.close).toHaveBeenCalledOnce();
  });
});

class FakeWebContents extends EventEmitter {
  readonly id = 1;

  isDestroyed(): boolean {
    return false;
  }

  send(): void {
    // The test only exercises subscription ownership.
  }
}

function asWebContents(sender: FakeWebContents): WebContents {
  return sender as unknown as WebContents;
}

function ipcHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const handler = reviewIpcMocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return async (...args: unknown[]) => handler(...args);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
