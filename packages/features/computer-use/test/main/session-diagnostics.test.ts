import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerSessionController, type ComputerSupervisor } from '../../src/main/session-controller.js';
import { ComputerControlServer } from '../../src/main/control-server.js';
import { ComputerControlClient } from '../../src/runtime/control-client.js';
import { ComputerRuntimeTools } from '../../src/runtime/tools.js';
import { ComputerSettingsService } from '../../src/main/settings.js';
import { DesktopComputerBackend } from '../../src/main/backend.js';
import type { ComputerDisplay, ComputerIdentity } from '../../src/contracts/index.js';
import type { ComputerDiagnostic } from '../../src/main/diagnostics.js';
import type { ComputerContext, ComputerFrame } from '../../src/contracts/index.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture(enabled = true) {
  let time = 0; let stop: (reason?: string) => void = () => undefined;
  const events: ComputerDiagnostic[] = [];
  const driver = { start: vi.fn(async () => undefined), action: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
  const supervisor: ComputerSupervisor & { display(): ComputerDisplay } = {
    checkPermissions() {}, registerStop: async (callback) => { stop = callback; }, unregisterStop() {}, showControl: async () => undefined, prepareInput() {},
    display: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1, height: 1 }, inputBounds: { x: 0, y: 0, width: 1, height: 1 }, scaleFactor: 1, inputCoordinateSpace: 'macos-points' }),
  };
  // Synthetic one-pixel PNG. No Electron, native driver, desktop or model access.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6V8AAAAASUVORK5CYII=';
  const capture = { capture: vi.fn(async () => ({ dataUrl: `data:image/png;base64,${png}`, width: 1, height: 1, size: Buffer.from(png, 'base64').length, capture: { backend: 'electron-desktop-capturer' as const, sourceDisplayId: '1', nearBlackFraction: 0, transparentFraction: 0, contrast: 255, interiorContrast: 255 } })) };
  const controller = new ComputerSessionController(new DesktopComputerBackend(driver, capture, supervisor.display), supervisor, () => time, undefined, (event) => events.push(event));
  const settings = new ComputerSettingsService('unused-test-settings.json', controller, async () => undefined, () => ({ screen: 'granted', accessibility: 'granted' }));
  if (enabled) await settings.setEnabled(true);
  const server = new ComputerControlServer(settings);
  const { url, token } = await server.start();
  const client = new ComputerControlClient(url, token);
  const runtime = new ComputerRuntimeTools(client);
  const context: ComputerContext = { threadId: 'synthetic-thread', turnId: 'synthetic-turn', modelCapabilities: { supportsImages: true } };
  cleanups.push(async () => { await controller.stop(); await server.stop(); });
  return { runtime, client, context, controller, settings, supervisor, events, driver, capture, advance: (ms: number) => { time += ms; }, revoke: (reason: string) => stop(reason) };
}

describe('diagnostic harness lifecycle through runtime, client, server and controller', () => {
  it('preserves the session across malformed model arguments and a duplicate start rejected by main', async () => {
    const f = await fixture();
    const started = await f.runtime.runTool('computer_start', {}, f.context);
    expect(JSON.parse(started.content)).not.toHaveProperty('sessionId');
    expect(started.data).not.toHaveProperty('sessionId');
    const stops = f.driver.stop.mock.calls.length;
    await expect(f.runtime.runTool('computer_screenshot', { sessionId: 'window-id' }, f.context)).rejects.toThrow('Unsupported');
    await expect(f.runtime.runTool('computer_action', { observationId: 'old', action: { kind: 'click', x: -1, y: 0 } }, f.context)).rejects.toThrow('Invalid');
    await expect(f.runtime.runTool('computer_start', {}, f.context)).rejects.toMatchObject({
      failure: { code: 'session-busy', sessionState: 'unchanged' },
    });
    expect(f.driver.stop).toHaveBeenCalledTimes(stops);
    expect(f.capture.capture).toHaveBeenCalledOnce();
    expect(f.driver.action).not.toHaveBeenCalled();

    const refreshed = JSON.parse((await f.runtime.runTool('computer_screenshot', {}, f.context)).content);
    await expect(f.runtime.runTool('computer_action', { observationId: refreshed.observationId, action: { kind: 'type', text: 'hello' } }, f.context))
      .resolves.toMatchObject({ data: { inputDispatched: true } });
    expect(f.driver.start).toHaveBeenCalledOnce();
    expect(f.driver.action).toHaveBeenCalledOnce();
    expect(f.events.filter((event) => event.event === 'command' && ['screenshot', 'action'].includes(event.command!)))
      .toEqual([expect.objectContaining({ sessionMatches: true }), expect.objectContaining({ sessionMatches: true })]);
  });

  it('distinguishes mismatched internal IDs from missing sessions without revoking the owner', async () => {
    const f = await fixture();
    await f.runtime.runTool('computer_start', {}, f.context);
    const identity: ComputerIdentity = { threadId: f.context.threadId, turnId: f.context.turnId!, unattended: false, readOnly: false, supportsImages: true };
    await expect(f.client.execute({ kind: 'screenshot', identity, sessionId: 'window-id' })).rejects.toMatchObject({
      failure: { code: 'session-mismatch', sessionState: 'unchanged' },
    });
    expect(f.controller.status().active).toBe(true);
    await expect(f.runtime.runTool('computer_screenshot', {}, f.context)).resolves.toHaveProperty('attachments');
    await f.runtime.runTool('computer_stop', {}, f.context);
    await expect(f.client.execute({ kind: 'screenshot', identity, sessionId: 'window-id' })).rejects.toMatchObject({
      failure: { code: 'session-required', sessionState: 'closed' },
    });
  });

  it.each([{ threadId: 'other-thread' }, { turnId: 'other-turn' }])('isolates runtime sessions and failed starts for %s', async (patch) => {
    const f = await fixture();
    await f.runtime.runTool('computer_start', {}, f.context);
    const other = { ...f.context, ...patch };
    const stops = f.driver.stop.mock.calls.length;
    await expect(f.runtime.runTool('computer_screenshot', {}, other)).rejects.toThrow('Call computer_start');
    await expect(f.runtime.runTool('computer_start', {}, other)).rejects.toMatchObject({
      failure: { code: 'session-busy', sessionState: 'closed' },
    });
    await f.runtime.cleanupTurn(other);
    expect(f.driver.stop).toHaveBeenCalledTimes(stops);
    await expect(f.runtime.runTool('computer_screenshot', {}, f.context)).resolves.toHaveProperty('attachments');
    expect(f.driver.start).toHaveBeenCalledOnce();
  });

  it('requires the newly returned observation after expiry without stopping or replaying input', async () => {
    const f = await fixture();
    const first = JSON.parse((await f.runtime.runTool('computer_start', {}, f.context)).content);
    const action = { kind: 'click', x: 0, y: 0 };
    f.advance(30_001);
    const refreshed = JSON.parse((await f.runtime.runTool('computer_action', { observationId: first.observationId, action }, f.context)).content);
    expect(refreshed).toMatchObject({ inputDispatched: false, actionError: expect.stringContaining('stale') });
    expect(refreshed.observationId).not.toBe(first.observationId);
    expect(f.driver.action).not.toHaveBeenCalled();
    const latest = JSON.parse((await f.runtime.runTool('computer_action', { observationId: first.observationId, action }, f.context)).content);
    expect(latest.inputDispatched).toBe(false);
    expect(f.driver.action).not.toHaveBeenCalled();
    await f.runtime.runTool('computer_action', { observationId: latest.observationId, action }, f.context);
    expect(f.driver.action).toHaveBeenCalledOnce();
    expect(f.events.filter((event) => event.event === 'stopped')).toEqual([]);
  });

  it('forgets a failed input session and leaves teardown to main without replaying input', async () => {
    const f = await fixture();
    const first = JSON.parse((await f.runtime.runTool('computer_start', {}, f.context)).content);
    const args = { observationId: first.observationId, action: { kind: 'type', text: 'hello' } };
    const stops = f.driver.stop.mock.calls.length;
    f.driver.action.mockRejectedValueOnce(new Error('Partial native input'));
    await expect(f.runtime.runTool('computer_action', args, f.context)).rejects.toMatchObject({
      failure: { code: 'operation-failed', sessionState: 'closed' },
      message: expect.stringContaining('do not replay automatically'),
    });
    expect(f.driver.stop).toHaveBeenCalledTimes(stops + 1);
    await expect(f.runtime.runTool('computer_action', args, f.context)).rejects.toThrow('Call computer_start');
    await f.runtime.cleanupTurn(f.context);
    expect(f.driver.stop).toHaveBeenCalledTimes(stops + 1);
    expect(f.driver.action).toHaveBeenCalledOnce();
  });

  it('cleans up an accepted start if its response is lost in transport', async () => {
    const f = await fixture();
    const runtime = new ComputerRuntimeTools({ isEnabled: () => f.client.isEnabled(), execute: async (command, signal) => {
      const result = await f.client.execute(command, signal);
      if (command.kind === 'start') throw new Error('Connection lost before reading response');
      return result;
    } });
    await expect(runtime.runTool('computer_start', {}, f.context)).rejects.toThrow('Connection lost');
    expect(f.controller.status().active).toBe(false);
    expect(f.events).toContainEqual(expect.objectContaining({ event: 'stopped', reason: 'tool-failed' }));
    await expect(runtime.runTool('computer_screenshot', {}, f.context)).rejects.toThrow('Call computer_start');
    expect(f.driver.start).toHaveBeenCalledOnce();
  });

  it('does not restore a session from a start response delivered after turn cleanup', async () => {
    const f = await fixture();
    let release!: () => void;
    const runtime = new ComputerRuntimeTools({ isEnabled: () => f.client.isEnabled(), execute: async (command, signal) => {
      const result = await f.client.execute(command, signal);
      if (command.kind === 'start') await new Promise<void>((resolve) => { release = resolve; });
      return result;
    } });
    const pending = runtime.runTool('computer_start', {}, f.context);
    const rejected = expect(pending).rejects.toThrow('turn ended');
    await vi.waitFor(() => expect(release).toBeDefined());
    await runtime.cleanupTurn(f.context);
    release(); await rejected;
    expect(f.controller.status().active).toBe(false);
    await expect(runtime.runTool('computer_screenshot', {}, f.context)).rejects.toThrow('Call computer_start');
    expect(f.capture.capture).toHaveBeenCalledOnce();
  });

  it('updates an existing chat tool catalog and rejects already advertised tools when disabled', async () => {
    const f = await fixture(false);
    expect(await f.runtime.listTools(f.context)).toEqual([]);
    await expect(f.runtime.runTool('computer_start', {}, f.context)).rejects.toThrow('disabled');
    expect(f.driver.start).not.toHaveBeenCalled();
    await f.settings.setEnabled(true);
    expect((await f.runtime.listTools(f.context)).map((tool) => tool.name)).toContain('computer_start');
    await f.runtime.runTool('computer_start', {}, f.context);
    await f.settings.setEnabled(false);
    expect(f.controller.status().active).toBe(false);
    expect(await f.runtime.listTools(f.context)).toEqual([]);
    await expect(f.runtime.runTool('computer_screenshot', {}, f.context)).rejects.toThrow('disabled');
    expect(f.capture.capture).toHaveBeenCalledOnce();
    await f.settings.setEnabled(true);
    await expect(f.runtime.runTool('computer_start', {}, f.context)).rejects.toThrow('stopped by the user');
    await expect(f.runtime.runTool('computer_start', {}, { ...f.context, turnId: 'new-user-turn' })).resolves.toHaveProperty('attachments');
  });

  it('disabling aborts in-flight input and invalidates queued commands even after re-enabling', async () => {
    const f = await fixture();
    const first = await f.runtime.runTool('computer_start', {}, f.context);
    const frame = first.data as ComputerFrame;
    let inputSignal: AbortSignal | undefined;
    f.driver.action.mockImplementationOnce(async (_action, _frame, signal) => {
      inputSignal = signal;
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const pending = f.runtime.runTool('computer_action', { observationId: frame.observationId, action: { kind: 'type', text: 'test' } }, f.context);
    const rejected = expect(pending).rejects.toThrow('stopped');
    await vi.waitFor(() => expect(inputSignal).toBeDefined());
    const queued = f.settings.execute({ kind: 'start', identity: { threadId: 'queued', turnId: 'queued-turn', unattended: false, readOnly: false, supportsImages: true } });
    const cancelled = expect(queued).rejects.toThrow('cancelled');
    const disabled = f.settings.setEnabled(false);
    expect(inputSignal?.aborted).toBe(true);
    expect(f.controller.status().active).toBe(false);
    await disabled; await f.settings.setEnabled(true);
    await Promise.all([rejected, cancelled]);
    expect(f.driver.start).toHaveBeenCalledOnce();
    expect(f.capture.capture).toHaveBeenCalledOnce();
  });
  it('keeps the same grant after preparation, local image disposal and a completed request signal', async () => {
    const f = await fixture(); f.advance(900_000);
    const completed = new AbortController();
    const first = await f.runtime.runTool('computer_start', {}, { ...f.context, signal: completed.signal });
    const pixels = Buffer.from(first.attachments![0]!.url!.split(',')[1]!, 'base64');
    expect(pixels.subarray(1, 4).toString()).toBe('PNG');
    pixels.fill(0); first.attachments!.length = 0; completed.abort();
    f.advance(3_600_000);
    const second = await f.runtime.runTool('computer_screenshot', {}, f.context);
    expect(second.data).toMatchObject({});
    expect(f.controller.status()).toMatchObject({ active: true });
    expect(f.capture.capture).toHaveBeenCalledTimes(2); expect(f.driver.action).not.toHaveBeenCalled();
    expect(f.events.filter((event) => event.event === 'stopped')).toEqual([]);
    expect(f.events.filter((event) => event.event === 'command').at(-1)).toMatchObject({ ownerMatches: true, sessionMatches: true, signalAborted: false });
  });
  it('rejects further observations after the emergency shortcut revokes the session', async () => {
    const f = await fixture(); await f.runtime.runTool('computer_start', {}, f.context);
    f.revoke('emergency-shortcut');
    await expect(f.runtime.runTool('computer_screenshot', {}, f.context)).rejects.toThrow('stopped by the user');
    await expect(f.runtime.runTool('computer_start', {}, f.context)).rejects.toThrow('stopped by the user');
    expect(f.capture.capture).toHaveBeenCalledOnce();
    expect(f.events.filter((event) => event.event === 'stopped')).toEqual([expect.objectContaining({ reason: 'emergency-shortcut', phase: 'observation-ready', run: 1 })]);
  });
  it.each(['turn-cleanup', 'image-delivery-failed'] as const)('distinguishes %s and never overwrites it with subsequent cleanup', async (reason) => {
    const f = await fixture(); await f.runtime.runTool('computer_start', {}, f.context);
    await f.runtime.cleanupTurn(f.context, reason); await f.runtime.cleanupTurn(f.context);
    expect(f.events.filter((event) => event.event === 'stopped')).toEqual([expect.objectContaining({ reason })]);
    expect(f.controller.status().active).toBe(false);
  });
  it('records the failing image phase and preserves it across runtime cleanup', async () => {
    const f = await fixture(); f.capture.capture.mockRejectedValue(new Error('private error text must not be journaled'));
    await expect(f.runtime.runTool('computer_start', {}, f.context)).rejects.toThrow('private error');
    expect(f.events).toContainEqual(expect.objectContaining({ event: 'stopped', reason: 'capture-failed', phase: 'capture' }));
    expect(JSON.stringify(f.events)).not.toContain('private error');
  });
});
