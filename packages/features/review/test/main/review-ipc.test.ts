import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureScopeUnavailableError } from '@setsuna-desktop/feature-core/status';
import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

const reviewIpcMocks = vi.hoisted(() => ({
  close: vi.fn(),
  getState: vi.fn(),
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
  commitReviewChanges: vi.fn(),
  createAndCheckoutReviewBranch: vi.fn(),
  discardUnstagedReviewFiles: vi.fn(),
  getCommitMessageGenerationSource: vi.fn(),
  getDesktopReviewState: reviewIpcMocks.getState,
  pushReviewBranch: vi.fn(),
  stageReviewFiles: vi.fn(),
  unstageReviewFiles: vi.fn(),
}));

import { registerReviewIpc } from '../../src/main/ipc.js';

afterEach(() => {
  reviewIpcMocks.handlers.clear();
  vi.clearAllMocks();
});

describe('review IPC lifecycle', () => {
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
