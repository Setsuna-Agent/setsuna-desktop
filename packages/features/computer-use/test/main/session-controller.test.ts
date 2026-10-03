import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerSessionController, type ComputerSupervisor } from '../../src/main/session-controller.js';
import { ComputerElevationCancelledError, StaleComputerObservationError, DesktopComputerBackend, type ComputerDriver, type ComputerCapture } from '../../src/main/backend.js';
import type { ComputerFrame, ComputerIdentity } from '../../src/contracts/index.js';

const identity: ComputerIdentity = { threadId: 'thread', turnId: 'turn', unattended: false, readOnly: false, supportsImages: true };
const controllers: ComputerSessionController[] = [];
afterEach(async () => { await Promise.all(controllers.splice(0).map((controller) => controller.stop())); });
function fixture() {
  let time = 1000;
  const driver = {
    start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), action: vi.fn(async () => undefined),
  } satisfies ComputerDriver;
  const image = { dataUrl: 'data:image/png;base64,YWJj', width: 200, height: 100, size: 3, capture: { backend: 'electron-desktop-capturer' as const, sourceDisplayId: '1', nearBlackFraction: 0, transparentFraction: 0, contrast: 255, interiorContrast: 255 } };
  const capture = { capture: vi.fn(async () => image) } satisfies ComputerCapture;
  const supervisor = {
    display: vi.fn(() => ({ id: 1, bounds: { x: 0, y: 0, width: 100, height: 50 }, scaleFactor: 2, inputBounds: { x: 0, y: 0, width: 100, height: 50 }, inputCoordinateSpace: 'macos-points' as const })),
    checkPermissions: vi.fn(), registerStop: vi.fn(async () => undefined), unregisterStop: vi.fn(), showControl: vi.fn(async () => undefined), prepareInput: vi.fn(),
  } satisfies ComputerSupervisor & { display(): unknown };
  const onStopped = vi.fn();
  const control = new ComputerSessionController(new DesktopComputerBackend(driver, capture, supervisor.display), supervisor, () => time, onStopped);
  controllers.push(control);
  const start = () => control.execute({ kind: 'start', identity }).then((value) => value as Extract<ComputerFrame, { scope: 'primary-desktop' }>);
  return { control, driver, supervisor, capture, image, start, onStopped, advance: (ms: number) => { time += ms; } };
}
describe('desktop sessions', () => {
  it.each([false, true])('prepares the indicator before input and refuses dispatch if it fails: %s', async (blocked) => {
    const f = fixture(); const frame = await f.start();
    if (blocked) f.supervisor.prepareInput.mockImplementationOnce(() => { throw new Error('Toolbar still blocks target'); });
    const action = { kind: 'click' as const, x: 25, y: 25 };
    const pending = f.control.execute({ kind: 'action', identity, sessionId: frame.sessionId, observationId: frame.observationId, action });
    if (blocked) {
      await expect(pending).rejects.toThrow('Toolbar still blocks target');
      expect(f.driver.action).not.toHaveBeenCalled();
      expect(f.control.status().active).toBe(false);
    } else {
      await pending;
      expect(f.supervisor.prepareInput).toHaveBeenCalledExactlyOnceWith(action, frame);
      expect(f.supervisor.prepareInput.mock.invocationCallOrder[0]).toBeLessThan(f.driver.action.mock.invocationCallOrder[0]!);
    }
  });

  it('waits for startup UAC before capture, then revokes the turn if authorization is declined', async () => {
    const f = fixture(); let deny!: (error: Error) => void;
    f.driver.start.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { deny = reject; }));
    const pending = f.start();
    const rejected = expect(pending).rejects.toThrow('authorization cancelled');
    await vi.waitFor(() => expect(deny).toBeDefined());
    expect(f.capture.capture).not.toHaveBeenCalled();
    deny(new ComputerElevationCancelledError('Administrator authorization cancelled.'));
    await rejected;
    expect(f.capture.capture).not.toHaveBeenCalled();
    expect(f.onStopped).toHaveBeenCalledExactlyOnceWith('elevation-cancelled', identity);
    await expect(f.start()).rejects.toThrow('stopped by the user');
  });
  it('revokes the turn after UAC cancellation instead of prompting again', async () => {
    const f = fixture(); const frame = await f.start();
    f.driver.action.mockRejectedValue(new ComputerElevationCancelledError('Administrator authorization cancelled.'));
    await expect(f.control.execute({ kind: 'action', identity, sessionId: frame.sessionId, observationId: frame.observationId,
      action: { kind: 'key', key: 'Enter' } })).rejects.toThrow('authorization cancelled');
    expect(f.onStopped).toHaveBeenCalledExactlyOnceWith('elevation-cancelled', identity);
    await expect(f.start()).rejects.toThrow('stopped by the user');
    expect(f.driver.start).toHaveBeenCalledOnce();
    await expect(f.control.execute({ kind: 'start', identity: { ...identity, turnId: 'new-turn' } })).resolves.toMatchObject({ kind: 'frame' });
  });
  it('refreshes after UAC without replaying input or reusing the pre-UAC observation', async () => {
    const f = fixture(); const frame = await f.start();
    f.driver.action.mockImplementationOnce(async () => { f.advance(60_000); throw new StaleComputerObservationError('Administrator access granted; refresh.'); });
    const command = { kind: 'action' as const, identity, sessionId: frame.sessionId, observationId: frame.observationId, action: { kind: 'type' as const, text: 'hello' } };
    const result = await f.control.execute(command) as ComputerFrame;
    expect(result).toMatchObject({ inputDispatched: false, actionError: 'Administrator access granted; refresh.', sessionId: frame.sessionId });
    expect(result.observationId).not.toBe(frame.observationId);
    expect(f.driver.action).toHaveBeenCalledOnce();
    await expect(f.control.execute(command)).resolves.toMatchObject({ inputDispatched: false, actionError: expect.stringContaining('stale') });
    expect(f.driver.action).toHaveBeenCalledOnce();
  });
  it('retains the first stop reason across cleanup without retaining screen or task content', async () => {
    const f = fixture(); const frame = await f.start();
    await f.control.stop('emergency-shortcut'); await f.control.stop();
    expect(f.onStopped).toHaveBeenCalledExactlyOnceWith('emergency-shortcut', identity);
    await expect(f.control.execute({ kind: 'screenshot', identity, sessionId: frame.sessionId })).rejects.toThrow('stopped by the user');
  });
  it('still shuts down input and surfaces a failed turn-cancellation callback', async () => {
    const f = fixture(); await f.start(); f.onStopped.mockImplementation(() => { throw new Error('sink failed'); });
    await expect(f.control.stop('requested')).rejects.toThrow('sink failed');
    expect(f.control.status().active).toBe(false); expect(f.driver.stop).toHaveBeenCalled();
  });
  it.each([{ readOnly: true }, { supportsImages: false }])('rejects incompatible context %s before driver access', async (patch) => {
    const f = fixture();
    await expect(f.control.execute({ kind: 'start', identity: { ...identity, ...patch } })).rejects.toThrow('writable');
    expect(f.driver.start).not.toHaveBeenCalled();
  });
  it('allows unattended turns and keeps long-running sessions until explicit cleanup', async () => {
    const f = fixture();
    const frame = await f.control.execute({ kind: 'start', identity: { ...identity, unattended: true } }) as ComputerFrame;
    f.advance(60 * 60 * 1000);
    await expect(f.control.execute({ kind: 'screenshot', identity: { ...identity, unattended: true }, sessionId: frame.sessionId })).resolves.toMatchObject({ sessionId: frame.sessionId });
    expect(f.control.status()).toEqual({ active: true, threadId: identity.threadId });
    await f.control.stop();
    expect(f.control.status().active).toBe(false);
  });
  it('does not prompt for or modify missing OS permissions', async () => {
    const f = fixture(); f.supervisor.checkPermissions.mockImplementation(() => { throw new Error('permissions missing'); });
    await expect(f.start()).rejects.toThrow('permissions missing');
    expect(f.driver.start).not.toHaveBeenCalled();
  });
  it('binds the session to its exact thread and turn and returns physical image/DPI metadata', async () => {
    const f = fixture(); const frame = await f.start();
    expect(frame).toMatchObject({ coordinateSpace: 'screenshot-pixels', width: 200, display: { scaleFactor: 2, bounds: { width: 100 } } });
    await expect(f.control.execute({ kind: 'screenshot', sessionId: frame.sessionId, identity: { ...identity, turnId: 'other' } })).rejects.toThrow('another turn');
    await expect(f.control.execute({ kind: 'stop', identity: { ...identity, threadId: 'other' } })).rejects.toThrow('another turn');
    expect(f.control.status().active).toBe(true);
  });
  it('requires a fresh observation and captures again after every input', async () => {
    const f = fixture(); const frame = await f.start();
    expect(f.control.preview()).toEqual({ active: true, threadId: identity.threadId, frame: {
      dataUrl: frame.dataUrl, width: frame.width, height: frame.height, observationId: frame.observationId,
    } });
    f.control.preview();
    expect(f.capture.capture).toHaveBeenCalledOnce();
    const command = { kind: 'action' as const, identity, sessionId: frame.sessionId, observationId: frame.observationId, action: { kind: 'click' as const, x: 199, y: 99 } };
    const after = await f.control.execute(command) as ComputerFrame;
    expect(after.observationId).not.toBe(frame.observationId); expect(after.inputDispatched).toBe(true);
    expect(f.control.preview().frame?.observationId).toBe(after.observationId);
    expect(f.capture.capture).toHaveBeenCalledTimes(2);
    await expect(f.control.execute(command)).resolves.toMatchObject({ inputDispatched: false, actionError: expect.stringContaining('stale') });
    expect(f.driver.action).toHaveBeenCalledOnce(); expect(f.control.status().active).toBe(true);
  });
  it('registers emergency stop before starting capture or input', async () => {
    const f = fixture(); let ready!: () => void;
    f.supervisor.registerStop.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    const starting = f.start();
    await vi.waitFor(() => expect(ready).toBeTypeOf('function'));
    expect(f.driver.start).not.toHaveBeenCalled(); expect(f.capture.capture).not.toHaveBeenCalled();
    ready(); const frame = await starting;
    expect(f.capture.capture).toHaveBeenCalledWith(frame.display, expect.any(AbortSignal));
  });
  it('does not start capture or input if emergency stop registration fails', async () => {
    const f = fixture(); f.supervisor.registerStop.mockRejectedValue(new Error('shortcut unavailable'));
    await expect(f.start()).rejects.toThrow('shortcut unavailable');
    expect(f.driver.start).not.toHaveBeenCalled(); expect(f.capture.capture).not.toHaveBeenCalled();
    expect(f.control.status().active).toBe(false);
  });
  it('withholds the first observation until the control indicator is ready and cancels pending input on stop', async () => {
    const f = fixture(); let release!: () => void;
    f.supervisor.showControl.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const starting = f.start();
    const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(f.control.preview().frame).toBeNull();
    expect(f.driver.action).not.toHaveBeenCalled();
    await f.control.stop('emergency-shortcut');
    release(); await rejected;
    expect(f.control.preview()).toEqual({ active: false, frame: null });
    expect(f.supervisor.unregisterStop).toHaveBeenCalled();
    await expect(f.start()).rejects.toThrow('stopped by the user');
  });
  it('closes the session when the indicator fails and never replays accepted input', async () => {
    const f = fixture(); const frame = await f.start();
    f.supervisor.showControl.mockRejectedValueOnce(new Error('indicator unavailable'));
    await expect(f.control.execute({ kind: 'action', identity, sessionId: frame.sessionId,
      observationId: frame.observationId, action: { kind: 'key', key: 'Tab' } })).rejects.toThrow('Input was dispatched');
    expect(f.driver.action).toHaveBeenCalledOnce();
    expect(f.driver.stop).toHaveBeenCalled();
    expect(f.control.status().active).toBe(false);
  });
  it('passes the consumed observation geometry to input and revokes on the next failed image', async () => {
    const f = fixture(); const frame = await f.start();
    f.capture.capture.mockRejectedValue(new Error('observation ambiguous'));
    const action = { kind: 'click' as const, x: 150, y: 40 };
    await expect(f.control.execute({ kind: 'action', identity, sessionId: frame.sessionId, observationId: frame.observationId, action })).rejects.toThrow('ambiguous');
    expect(f.driver.action).toHaveBeenCalledWith(action, frame, expect.any(AbortSignal));
    expect(f.control.status().active).toBe(false);
    await expect(f.control.execute({ kind: 'action', identity, sessionId: frame.sessionId, observationId: frame.observationId, action })).rejects.toThrow('No desktop session');
    expect(f.driver.action).toHaveBeenCalledOnce();
  });
  it('rejects expired images and out-of-bounds coordinates', async () => {
    for (const expired of [false, true]) {
      const f = fixture(); const frame = await f.start(); if (expired) f.advance(30_001);
      const refreshed = await f.control.execute({ kind: 'action', identity, sessionId: frame.sessionId, observationId: frame.observationId, action: { kind: 'click', x: expired ? 0 : 200, y: 0 } }) as ComputerFrame;
      expect(refreshed).toMatchObject({ inputDispatched: false, actionError: expect.stringContaining(expired ? 'stale' : 'outside'), sessionId: frame.sessionId });
      expect(refreshed.observationId).not.toBe(frame.observationId);
      expect(f.driver.action).not.toHaveBeenCalled(); expect(f.control.status().active).toBe(true);
    }
  });
  it('binds pixel bounds to the latest image when screenshot dimensions change', async () => {
    const f = fixture(); const first = await f.start();
    f.capture.capture.mockResolvedValue({ ...f.image, width: 400, height: 200 });
    const command = { kind: 'action' as const, identity, sessionId: first.sessionId, observationId: first.observationId,
      action: { kind: 'click' as const, x: 300, y: 150 } };
    const refreshed = await f.control.execute(command) as ComputerFrame;
    expect(refreshed).toMatchObject({ inputDispatched: false, width: 400, height: 200, actionError: expect.stringContaining('outside') });
    expect(f.driver.action).not.toHaveBeenCalled();
    const stale = await f.control.execute(command) as ComputerFrame;
    expect(stale).toMatchObject({ inputDispatched: false, actionError: expect.stringContaining('stale') });
    expect(f.driver.action).not.toHaveBeenCalled();
    await f.control.execute({ ...command, observationId: stale.observationId });
    expect(f.driver.action).toHaveBeenCalledExactlyOnceWith(command.action, stale, expect.any(AbortSignal));
  });
  it.each([false, true])('reports whether input preceded a failed screenshot (dispatched=%s)', async (dispatched) => {
    const f = fixture(); const frame = await f.start();
    if (!dispatched) f.driver.action.mockRejectedValueOnce(new StaleComputerObservationError('Permissions changed; refresh.'));
    f.capture.capture.mockRejectedValueOnce(new Error('Failed to get sources.'));
    const command = { kind: 'action' as const, identity, sessionId: frame.sessionId, observationId: frame.observationId, action: { kind: 'key' as const, key: 'Enter' as const } };
    await expect(f.control.execute(command)).rejects.toThrow(dispatched ? 'Input was dispatched, but its effect could not be observed; do not replay it automatically' : 'Input was not dispatched');
    expect(f.control.status().active).toBe(false);
    await expect(f.control.execute(command)).rejects.toThrow('No desktop session');
    expect(f.driver.action).toHaveBeenCalledOnce();
  });
  it('stops on display changes, capture failures and blank images', async () => {
    for (const failure of ['display', 'capture', 'blank']) {
      const f = fixture(); const frame = await f.start();
      if (failure === 'display') f.supervisor.display.mockReturnValue({ ...frame.display, scaleFactor: 1 });
      if (failure === 'capture') f.capture.capture.mockRejectedValue(new Error('capture failed'));
      if (failure === 'blank') f.capture.capture.mockResolvedValue({ ...f.image, dataUrl: '', width: 0, height: 0, size: 0 });
      await expect(f.control.execute({ kind: 'screenshot', identity, sessionId: frame.sessionId })).rejects.toThrow();
      expect(f.control.status().active).toBe(false); expect(f.driver.stop).toHaveBeenCalled();
    }
  });
  it('serializes concurrent threads globally without granting a second session', async () => {
    const f = fixture(); const first = f.start();
    const second = f.control.execute({ kind: 'start', identity: { ...identity, threadId: 'second' } });
    await first; await expect(second).rejects.toThrow('global controller');
    expect(f.driver.start).toHaveBeenCalledOnce();
  });
  it('revokes immediately and cancels queued work on emergency stop', async () => {
    const f = fixture(); const frame = await f.start(); let release!: () => void;
    f.driver.action.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const input = f.control.execute({ kind: 'action', identity, sessionId: frame.sessionId, observationId: frame.observationId, action: { kind: 'key', key: 'Tab' } });
    const rejected = expect(input).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(f.control.preview().frame?.observationId).toBe(frame.observationId);
    const queued = f.control.execute({ kind: 'start', identity });
    const queuedRejected = expect(queued).rejects.toThrow('cancelled');
    await f.control.stop(); expect(f.control.status().active).toBe(false);
    expect(f.control.preview()).toEqual({ active: false, frame: null });
    release(); await rejected; await queuedRejected;
    expect(f.control.preview()).toEqual({ active: false, frame: null });
    expect(f.driver.start).toHaveBeenCalledOnce();
  });
  it('cancels startup without starting the driver', async () => {
    const f = fixture(); let release!: () => void;
    f.supervisor.registerStop.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const abort = new AbortController(); const pending = f.control.execute({ kind: 'start', identity }, abort.signal);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    abort.abort(); release(); await rejected;
    expect(f.driver.start).not.toHaveBeenCalled(); expect(f.control.status().active).toBe(false);
  });
  it('detaches the completed operation signal from subsequent observations', async () => {
    const f = fixture(); const oldRequest = new AbortController();
    const frame = await f.control.execute({ kind: 'start', identity }, oldRequest.signal) as ComputerFrame;
    oldRequest.abort(new DOMException('old request', 'TimeoutError'));
    await expect(f.control.execute({ kind: 'screenshot', sessionId: frame.sessionId, identity })).resolves.toMatchObject({ kind: 'frame' });
    expect(f.onStopped).not.toHaveBeenCalled();
  });
  it.each([
    [new DOMException('timeout', 'TimeoutError'), 'command-timeout'],
    [new Error('transport-disconnected'), 'transport-disconnected'],
    [new Error('turn-cancelled'), 'command-cancelled'],
  ])('keeps the actual in-flight abort cause %s', async (cause, reason) => {
    const f = fixture(); const frame = await f.start(); let release!: () => void;
    f.capture.capture.mockImplementation(() => new Promise((resolve) => { release = () => resolve(f.image); }));
    const abort = new AbortController();
    const pending = f.control.execute({ kind: 'screenshot', sessionId: frame.sessionId, identity }, abort.signal);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    abort.abort(cause); release(); await rejected;
    expect(f.onStopped).toHaveBeenCalledExactlyOnceWith(reason, identity);
    expect(f.control.status().active).toBe(false);
  });
  it.each(['user-stop', 'emergency-shortcut', 'settings-disabled'])('cancels the exact owner and rejects automatic restart after %s, while allowing a new user turn', async (reason) => {
    const f = fixture(); await f.start();
    let notified!: () => void;
    f.onStopped.mockImplementationOnce(() => new Promise<void>((resolve) => { notified = resolve; }));
    const stopped = f.control.stop(reason);
    expect(f.control.status().active).toBe(false);
    expect(f.onStopped).toHaveBeenCalledExactlyOnceWith(reason, identity);
    await expect(f.start()).rejects.toThrow('stopped by the user');
    // Runtime cleanup is reentrant; it must not clear revocation or deadlock on cancellation.
    await f.control.execute({ kind: 'stop', reason: 'turn-cleanup', identity });
    await expect(f.start()).rejects.toThrow('stopped by the user');
    notified(); await stopped;
    await expect(f.control.execute({ kind: 'start', identity: { ...identity, turnId: 'next-user-turn' } })).resolves.toMatchObject({ kind: 'frame' });
    expect(f.driver.start).toHaveBeenCalledTimes(2);
  });
});
