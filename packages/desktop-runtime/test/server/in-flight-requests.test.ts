import { describe, expect, it, vi } from 'vitest';
import { InFlightRequestTracker } from '../../src/server/in-flight-requests.js';

describe('in-flight request tracker', () => {
  it('waits for every admitted handler and ignores duplicate completion', async () => {
    const tracker = new InFlightRequestTracker();
    const finishFirst = tracker.begin();
    const finishSecond = tracker.begin();
    const becameIdle = vi.fn();
    const waiting = tracker.waitForIdle().then(becameIdle);

    finishFirst();
    finishFirst();
    await Promise.resolve();
    expect(becameIdle).not.toHaveBeenCalled();

    finishSecond();
    await waiting;
    expect(becameIdle).toHaveBeenCalledOnce();
    await expect(tracker.waitForIdle()).resolves.toBeUndefined();
  });
});
