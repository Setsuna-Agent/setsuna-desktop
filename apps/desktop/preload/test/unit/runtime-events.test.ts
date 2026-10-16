import type {
  DesktopRuntimeEventPayload,
  RuntimeEventBatch,
  SetsunaDesktopBridge,
} from '@setsuna-desktop/contracts';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: mocks,
  webUtils: {},
}));
vi.mock('../../src/composition/builtin-preload-features.js', () => ({
  composeBuiltinPreloadBridge: (bridge: SetsunaDesktopBridge) => bridge,
}));
import '../../src/index.js';

const bridge = mocks.exposeInMainWorld.mock.calls[0]![1] as SetsunaDesktopBridge;

beforeEach(() => vi.clearAllMocks());

it.each(['before', 'after'] as const)(
  'delivers a resync-only batch before subsequent events when it arrives %s subscription setup',
  async (timing) => {
    let resolveSubscription!: (id: string) => void;
    const attaching = new Promise<string>((resolve) => { resolveSubscription = resolve; });
    mocks.invoke.mockReturnValueOnce(attaching).mockResolvedValue(undefined);
    const onBatch = vi.fn();
    const stop = bridge.runtime.startSse('thread_1', 2, onBatch);
    const listener = mocks.on.mock.calls[0]![1] as (
      event: unknown, payload: DesktopRuntimeEventPayload,
    ) => void;
    const resyncBatch: RuntimeEventBatch = {
      events: [],
      resync: {
        reason: 'retention_gap',
        requestedSinceSeq: 2,
        retainedFromSeq: 6,
        thread: {
          id: 'thread_1',
          title: 'Thread',
          createdAt: '2026-10-16T00:00:00.000Z',
          updatedAt: '2026-10-16T00:00:00.000Z',
          archived: false,
          messageCount: 0,
          lastMessagePreview: '',
          lastSeq: 8,
          messages: [],
        },
      },
    };
    const liveBatch: RuntimeEventBatch = {
      events: [{
        id: 'event_9',
        threadId: 'thread_1',
        turnId: 'turn_1',
        createdAt: '2026-10-16T00:00:01.000Z',
        seq: 9,
        type: 'turn.started',
        payload: { input: 'Hello' },
      }],
    };
    if (timing === 'after') {
      resolveSubscription('subscription_1');
      await attaching;
    }

    listener({}, { subscriptionId: 'another_subscription', batch: resyncBatch });
    listener({}, { subscriptionId: 'subscription_1', batch: resyncBatch });
    listener({}, { subscriptionId: 'subscription_1', batch: liveBatch });
    if (timing === 'before') {
      expect(onBatch).not.toHaveBeenCalled();
      resolveSubscription('subscription_1');
      await attaching;
    }

    expect(onBatch.mock.calls).toEqual([[resyncBatch], [liveBatch]]);
    stop();
    expect(mocks.off).toHaveBeenCalledWith('runtime:event', listener);
    expect(mocks.invoke).toHaveBeenLastCalledWith('runtime:unsubscribe', 'subscription_1');
  },
);
