import { describe, expect, it } from 'vitest';
import { ToolCallScheduler } from '../../../src/loop/tools/tool-call-scheduler.js';

describe('tool call scheduling', () => {
  it('bounds parallel admission and preserves exclusive barriers', async () => {
    const scheduler = new ToolCallScheduler(2, new AbortController().signal);
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const calls = [1, 2, 3].map(id => scheduler.run(true, async () => { order.push(`read${id}`); await held; }));
    calls.push(scheduler.run(false, async () => { order.push('write'); }));
    calls.push(scheduler.run(true, async () => { order.push('after'); }));
    expect(order).toEqual(['read1', 'read2']);
    release();
    await Promise.all(calls);
    await scheduler.close();
    expect(order).toEqual(['read1', 'read2', 'read3', 'write', 'after']);
  });

  it('rejects queued work on cancellation and waits for active cleanup', async () => {
    const controller = new AbortController();
    const scheduler = new ToolCallScheduler(1, controller.signal);
    let release!: () => void;
    const active = scheduler.run(false, () => new Promise<void>(resolve => { release = resolve; }));
    const queued = scheduler.run(true, async () => { throw new Error('must not execute'); });
    const rejected = expect(queued).rejects.toThrow('cancel');
    controller.abort(new Error('cancel'));
    await rejected;
    let closed = false;
    const closing = scheduler.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await active; await closing;
    expect(closed).toBe(true);
  });
});
