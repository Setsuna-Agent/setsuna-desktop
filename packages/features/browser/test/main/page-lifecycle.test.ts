import { afterEach, expect, it, vi } from 'vitest';
import { BrowserPageLifecycle } from '../../src/main/page-lifecycle.js';
import type { BrowserPageSleepBlocker } from '../../src/contracts/index.js';

afterEach(() => vi.useRealTimers());

function fixture() {
  const port = {
    blocker: vi.fn((): BrowserPageSleepBlocker | null => null),
    inspect: vi.fn(async (_signal: AbortSignal): Promise<BrowserPageSleepBlocker | null> => null),
    setFrozen: vi.fn(async (_frozen: boolean) => undefined),
    changed: vi.fn(),
    dispose: vi.fn(),
  };
  return { port, lifecycle: new BrowserPageLifecycle(port) };
}

it('does no inspection on construction and wakes before tool work, protecting it until completion', async () => {
  const { port, lifecycle } = fixture();
  expect(port.inspect).not.toHaveBeenCalled();
  expect(port.setFrozen).not.toHaveBeenCalled();
  expect(await lifecycle.setSuspended(true)).toEqual({ suspended: true });
  let finish!: () => void;
  let entered!: () => void;
  const running = new Promise<void>((resolve) => { entered = resolve; });
  const work = lifecycle.run(() => {
    expect(port.setFrozen).toHaveBeenLastCalledWith(false);
    entered();
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  await running;
  expect(await lifecycle.setSuspended(true)).toEqual({ suspended: false, blocker: 'busy' });
  finish(); await work;
  expect(await lifecycle.setSuspended(true)).toEqual({ suspended: true });
  expect(port.changed.mock.calls).toEqual([[true], [false], [true]]);
});

it.each(['busy', 'media', 'unsaved'] as const)('preserves pages protected by %s', async (blocker) => {
  const { port, lifecycle } = fixture();
  port.inspect.mockResolvedValue(blocker);
  expect(await lifecycle.setSuspended(true)).toEqual({ suspended: false, blocker });
  expect(port.setFrozen).not.toHaveBeenCalled();
});

it('invalidates a pending inspection when work arrives or the page closes', async () => {
  for (const close of [false, true]) {
    const { port, lifecycle } = fixture();
    let finish!: (value: null) => void;
    port.inspect.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const sleeping = lifecycle.setSuspended(true);
    await Promise.resolve();
    const operation = vi.fn();
    if (close) lifecycle.dispose();
    const work = close ? Promise.resolve() : lifecycle.run(operation);
    finish(null);
    expect((await sleeping).blocker).toBe(close ? 'unavailable' : 'busy');
    await work;
    expect(port.setFrozen).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledTimes(close ? 0 : 1);
    expect(port.dispose).toHaveBeenCalledTimes(close ? 1 : 0);
  }
});

it('fails closed on a stalled inspection and still permits later work', async () => {
  vi.useFakeTimers();
  const { port, lifecycle } = fixture();
  port.inspect.mockImplementation(() => new Promise(() => undefined));
  const sleeping = lifecycle.setSuspended(true);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await sleeping).toEqual({ suspended: false, blocker: 'unavailable' });
  expect(port.inspect.mock.calls[0][0].aborted).toBe(true);
  expect(await lifecycle.run(async () => 'usable')).toBe('usable');
  expect(port.setFrozen).not.toHaveBeenCalled();
});

it('does not run a tool when waking fails and allows a later retry', async () => {
  const { port, lifecycle } = fixture();
  await lifecycle.setSuspended(true);
  port.setFrozen.mockRejectedValueOnce(new Error('DevTools unavailable'));
  const operation = vi.fn(async () => 'done');
  await expect(lifecycle.run(operation)).rejects.toThrow('resumed');
  expect(operation).not.toHaveBeenCalled();
  expect(lifecycle.isSuspended).toBe(true);
  expect(await lifecycle.run(operation)).toBe('done');
  expect(lifecycle.isSuspended).toBe(false);
});

it('cancels a stalled page inspection immediately when the owning operation drains', async () => {
  const { port, lifecycle } = fixture();
  const controller = new AbortController();
  port.inspect.mockImplementation(() => new Promise(() => undefined));
  const sleeping = lifecycle.setSuspended(true, controller.signal);
  await Promise.resolve();
  controller.abort();
  expect(await sleeping).toEqual({ suspended: false, blocker: 'unavailable' });
  expect(port.inspect.mock.calls[0][0].aborted).toBe(true);
  expect(port.setFrozen).not.toHaveBeenCalled();
});

it('invalidates a late freeze completion after the renderer process exits', async () => {
  const { port, lifecycle } = fixture();
  let frozen!: () => void;
  port.setFrozen.mockImplementationOnce(() => new Promise<void>(resolve => { frozen = resolve; }));
  const sleeping = lifecycle.setSuspended(true);
  await vi.waitFor(() => expect(port.setFrozen).toHaveBeenCalledWith(true));
  lifecycle.reset();
  frozen();
  expect(await sleeping).toEqual({ suspended: false, blocker: 'unavailable' });
  expect(lifecycle.isSuspended).toBe(false);
  expect(port.changed).toHaveBeenCalledWith(false);
  expect(port.dispose).toHaveBeenCalledOnce();
  expect(await lifecycle.run(() => 'reloaded')).toBe('reloaded');
});
