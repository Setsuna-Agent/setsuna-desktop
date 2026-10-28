import { expect, it, vi } from 'vitest';
import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import { InMemoryEventBus } from '../../src/adapters/event/in-memory-event-bus.js';
import { observeRuntimeActivity } from '../../src/server/runtime-activity.js';

it('counts concurrent live turns, ignores queued inputs, and releases on failure, cancellation and disposal', () => {
  const bus = new InMemoryEventBus();
  const publish = vi.fn();
  const stop = observeRuntimeActivity(bus, publish);
  const event = (type: StoredThreadEvent['type'], turnId?: string, threadId = 'thread-a') => bus.publish({ type, turnId, threadId } as StoredThreadEvent);
  expect(publish).not.toHaveBeenCalled();
  event('turn.input_queued', 'later');
  event('turn.started', 'a'); event('turn.started', 'a');
  event('turn.started', 'b', 'thread-b');
  event('turn.completed', 'a'); event('turn.completed', 'a');
  event('runtime.error', undefined, 'thread-b');
  event('turn.started', 'c'); event('turn.cancelled', 'c');
  expect(publish.mock.calls.map(([count]) => count)).toEqual([1, 2, 1, 0, 1, 0]);
  stop(); event('turn.started', 'late');
  expect(publish).toHaveBeenLastCalledWith(0);
});
