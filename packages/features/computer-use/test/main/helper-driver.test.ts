import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/test' } }));
import { HelperComputerDriver } from '../../src/main/helper-driver.js';
import { StaleComputerObservationError, type DesktopInputFrame } from '../../src/main/backend.js';
const frame: DesktopInputFrame = { width: 800, height: 400, display: { id: 42, bounds: { x: 0, y: 0, width: 1000, height: 500 }, scaleFactor: 2,
  inputBounds: { x: 0, y: 0, width: 2000, height: 1000 }, inputCoordinateSpace: 'windows-physical-pixels' } };

describe('Windows input helper', () => {
  it('requests access at first use and retains the confirmed grant across normal sessions', async () => {
    const transport = { request: vi.fn(async (command: { kind: string }) => command.kind === 'start'
      ? { ready: true, integrityLevel: 12288 } : { stopped: true }), stop: vi.fn() };
    const driver = new HelperComputerDriver(undefined, transport);
    const signal = new AbortController().signal;
    expect(driver.isAuthorized()).toBe(false);
    await driver.start('first', signal);
    expect(transport.request).toHaveBeenCalledExactlyOnceWith({ kind: 'start', elevate: true }, signal);
    expect(driver.isAuthorized()).toBe(true);
    await driver.authorize(signal); // Opening Settings after automatic UAC needs no new grant.
    expect(transport.request).toHaveBeenCalledTimes(1);
    for (const reason of ['requested', 'turn-cleanup']) {
      await driver.stop(reason);
      expect(transport.request).toHaveBeenLastCalledWith({ kind: 'end-session' }, expect.any(AbortSignal));
      expect(driver.isAuthorized()).toBe(true);
      await driver.start('next', signal);
    }
    expect(transport.stop).not.toHaveBeenCalled();
    await driver.stop('runtime-exited');
    expect(driver.isAuthorized()).toBe(false);
    expect(transport.stop).toHaveBeenCalledOnce();
  });
  it('rejects startup without a confirmed administrator token', async () => {
    const transport = { request: vi.fn().mockResolvedValue({ ready: true, integrityLevel: 8192 }), stop: vi.fn() };
    const driver = new HelperComputerDriver(undefined, transport);
    await expect(driver.start('first', new AbortController().signal)).rejects.toThrow('did not confirm administrator access');
    expect(driver.isAuthorized()).toBe(false);
  });
  it('grants access without starting input, reuses it across turns, and revokes on explicit stop', async () => {
    const transport = { request: vi.fn(async (command: { kind: string }) => command.kind === 'authorize'
      ? { authorized: true, integrityLevel: 12288 } : command.kind === 'start' ? { ready: true, integrityLevel: 12288 } : { stopped: true }), stop: vi.fn() };
    const driver = new HelperComputerDriver(undefined, transport);
    const signal = new AbortController().signal;
    await driver.authorize(signal);
    expect(driver.isAuthorized()).toBe(true);
    expect(transport.request).toHaveBeenCalledExactlyOnceWith({ kind: 'authorize' }, signal);
    await driver.start('first', signal);
    expect(transport.request).toHaveBeenLastCalledWith({ kind: 'start', elevate: true }, signal);
    await driver.stop('turn-cleanup');
    expect(transport.request).toHaveBeenLastCalledWith({ kind: 'end-session' }, expect.any(AbortSignal));
    expect(transport.stop).not.toHaveBeenCalled();
    await driver.authorize(signal);
    await driver.start('second', signal);
    expect(transport.request.mock.calls.filter(([command]) => command.kind === 'authorize')).toHaveLength(1);
    await driver.stop('user-stop');
    expect(driver.isAuthorized()).toBe(false);
    expect(transport.stop).toHaveBeenCalledOnce();
  });
  it('does not retain a denied or falsely acknowledged administrator grant', async () => {
    const transport = { request: vi.fn().mockResolvedValue({ authorized: true, integrityLevel: 8192 }), stop: vi.fn() };
    const driver = new HelperComputerDriver(undefined, transport);
    await expect(driver.authorize(new AbortController().signal)).rejects.toThrow('did not confirm administrator access');
    expect(driver.isAuthorized()).toBe(false);
    expect(transport.stop).toHaveBeenCalledOnce();
  });
  it('passes screenshot and physical dimensions without a second coordinate conversion', async () => {
    const transport = { request: vi.fn().mockResolvedValue({ dispatched: true }), stop: vi.fn() };
    const driver = new HelperComputerDriver(undefined, transport);
    await driver.action({ kind: 'click', x: 400, y: 200 }, frame, new AbortController().signal);
    expect(transport.request.mock.calls[0][0]).toEqual({ kind: 'action', action: { kind: 'click', x: 400, y: 200 },
      frame: { width: 800, height: 400, screenWidth: 2000, screenHeight: 1000 } });
  });
  it('never reports successful input without native acknowledgement', async () => {
    const transport = { request: vi.fn().mockResolvedValue({}), stop: vi.fn() };
    const driver = new HelperComputerDriver(undefined, transport);
    await expect(driver.action({ kind: 'key', key: 'Enter' }, frame, new AbortController().signal)).rejects.toThrow('did not confirm');
  });
  it('propagates the post-UAC fresh-observation requirement without replaying input', async () => {
    const changed = new StaleComputerObservationError('Administrator access granted; refresh screenshot.');
    const transport = { request: vi.fn().mockRejectedValue(changed), stop: vi.fn() };
    const driver = new HelperComputerDriver(undefined, transport);
    await expect(driver.action({ kind: 'type', text: 'hello' }, frame, new AbortController().signal)).rejects.toBe(changed);
    expect(transport.request).toHaveBeenCalledOnce();
  });
  it('keeps diagnostics read-only and closes the helper afterwards', async () => {
    const transport = { request: vi.fn().mockResolvedValue({ protocolVersion: 1, integrityLevel: 8192 }), stop: vi.fn() };
    await new HelperComputerDriver(undefined, transport).probe();
    expect(transport.request.mock.calls[0][0]).toEqual({ kind: 'probe' });
    expect(transport.stop).toHaveBeenCalledOnce();
  });
});
