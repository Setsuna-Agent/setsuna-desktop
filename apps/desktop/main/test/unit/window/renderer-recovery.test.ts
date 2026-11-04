import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDesktopRendererRecovery } from '../../../src/window/renderer-recovery.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('desktop renderer recovery', () => {
  it('reloads a crashed foreground document once without revealing or focusing the window', async () => {
    const fixture = createFixture();
    fixture.crash('oom');
    fixture.native.emit('focus');
    fixture.native.emit('show');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.load).toHaveBeenCalledOnce();
    expect(fixture.native.show).not.toHaveBeenCalled();
    expect(fixture.native.focus).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[desktop-renderer] render process gone', {
      senderId: 7, reason: 'oom', exitCode: 1,
    });
    fixture.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('defers background recovery until the window is visible and restored', async () => {
    const fixture = createFixture();
    fixture.setVisible(false);
    fixture.setMinimized(true);
    fixture.crash();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.load).not.toHaveBeenCalled();
    fixture.setVisible(true);
    fixture.native.emit('show');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.load).not.toHaveBeenCalled();
    fixture.setMinimized(false);
    fixture.native.emit('restore');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.load).toHaveBeenCalledOnce();
    fixture.close();
  });

  it('does not reload healthy, merely unresponsive, or normally exiting documents', async () => {
    const fixture = createFixture();
    fixture.native.emit('show');
    fixture.native.emit('focus');
    fixture.native.emit('unresponsive');
    fixture.crash('clean-exit');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.load).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('[desktop-renderer] window unresponsive', { senderId: 7 });
    fixture.close();
  });

  it('stops crash loops after two attempts and does not reset the budget on page load alone', async () => {
    const fixture = createFixture();
    for (let i = 0; i < 3; i += 1) {
      fixture.crash();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    fixture.native.emit('focus');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fixture.load).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith('[desktop-renderer] automatic recovery limit reached', { senderId: 7 });
    fixture.close();
  });

  it('allows a later independent crash to recover after one minute of stable uptime', async () => {
    const fixture = createFixture();
    for (let i = 0; i < 3; i += 1) {
      fixture.crash();
      await vi.advanceTimersByTimeAsync(61_000);
    }
    expect(fixture.load).toHaveBeenCalledTimes(3);
    fixture.close();
  });

  it('bounds rejected recovery loads and observes their errors', async () => {
    const fixture = createFixture();
    fixture.load.mockRejectedValue(new Error('File unavailable'));
    fixture.crash();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fixture.load).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith('[desktop-renderer] recovery load failed',
      { senderId: 7, attempt: 2 }, expect.any(Error));
    fixture.close();
  });

  it('serializes recovery if another process exits while a reload is pending', async () => {
    const fixture = createFixture();
    let resolve!: () => void;
    fixture.load.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    fixture.crash();
    await vi.advanceTimersByTimeAsync(1_000);
    fixture.crash();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fixture.load).toHaveBeenCalledOnce();
    resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.load).toHaveBeenCalledTimes(2);
    fixture.close();
  });

  it.each(['quit', 'close', 'contents-destroyed', 'hidden'])('rechecks %s before a scheduled reload', async (condition) => {
    const fixture = createFixture();
    fixture.crash();
    if (condition === 'quit') fixture.setAllowed(false);
    if (condition === 'close') fixture.close();
    if (condition === 'contents-destroyed') fixture.setContentsDestroyed(true);
    if (condition === 'hidden') fixture.setVisible(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fixture.load).not.toHaveBeenCalled();
    if (condition !== 'close') fixture.close();
    expect(fixture.native.webContents.listenerCount('render-process-gone')).toBe(0);
    expect(fixture.native.listenerCount('focus')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not schedule work when shutdown already started or when a late load settles after close', async () => {
    const fixture = createFixture();
    fixture.setAllowed(false);
    fixture.crash();
    expect(vi.getTimerCount()).toBe(0);
    fixture.setAllowed(true);
    let resolve!: () => void;
    fixture.load.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    fixture.crash();
    await vi.advanceTimersByTimeAsync(1_000);
    fixture.close();
    resolve();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fixture.load).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function createFixture() {
  let visible = true;
  let minimized = false;
  let destroyed = false;
  let contentsDestroyed = false;
  let allowed = true;
  const native = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => contentsDestroyed, isCrashed: () => false }),
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isMinimized: () => minimized,
    show: vi.fn(), focus: vi.fn(),
  });
  const load = vi.fn(async (): Promise<void> => undefined);
  registerDesktopRendererRecovery(native as unknown as BrowserWindow, { load, canRecover: () => allowed });
  return {
    native, load,
    setVisible: (value: boolean) => { visible = value; },
    setMinimized: (value: boolean) => { minimized = value; },
    setAllowed: (value: boolean) => { allowed = value; },
    setContentsDestroyed: (value: boolean) => { contentsDestroyed = value; },
    crash: (reason = 'crashed') => native.webContents.emit('render-process-gone', {}, { reason, exitCode: 1 }),
    close: () => { destroyed = true; native.emit('closed'); },
  };
}
