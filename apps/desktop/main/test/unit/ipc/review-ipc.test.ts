import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeHost } from '../../../src/runtime/host.js';
import type { DesktopNativeBridgeServer } from '../../../src/runtime/native-bridge-server.js';

const reviewIpcMocks = vi.hoisted(() => ({
  close: vi.fn(),
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

vi.mock('../../../src/review/change-monitor.js', () => ({
  DesktopReviewChangeMonitor: class {
    readonly close = reviewIpcMocks.close;
    readonly subscribe = reviewIpcMocks.subscribe;
  },
}));

vi.mock('../../../src/review/state.js', () => ({
  checkoutReviewBranch: vi.fn(),
  commitReviewChanges: vi.fn(),
  createAndCheckoutReviewBranch: vi.fn(),
  discardUnstagedReviewFiles: vi.fn(),
  getCommitMessageGenerationSource: vi.fn(),
  getDesktopReviewState: vi.fn(),
  pushReviewBranch: vi.fn(),
  stageReviewFiles: vi.fn(),
  unstageReviewFiles: vi.fn(),
}));

vi.mock('../../../src/ipc/sender.js', () => ({
  isDesktopRendererSender: () => true,
}));

import { registerReviewIpc } from '../../../src/ipc/review-ipc.js';

afterEach(() => {
  reviewIpcMocks.handlers.clear();
  vi.clearAllMocks();
});

describe('review IPC subscriptions', () => {
  it('keeps the newest watcher when concurrent subscription requests finish out of order', async () => {
    const firstSubscription = deferred<() => void>();
    const secondSubscription = deferred<() => void>();
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();
    reviewIpcMocks.subscribe
      .mockReturnValueOnce(firstSubscription.promise)
      .mockReturnValueOnce(secondSubscription.promise);
    const sender = new FakeWebContents();
    const unregister = registerReviewIpc(
      {} as RuntimeHost,
      { webContents: sender } as unknown as BrowserWindow,
      {} as DesktopNativeBridgeServer,
    );
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

    unregister();
    expect(disposeSecond).toHaveBeenCalledOnce();
  });
});

class FakeWebContents extends EventEmitter {
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
