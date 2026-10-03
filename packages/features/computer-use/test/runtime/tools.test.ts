import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/test' } }));
import { ComputerRuntimeTools } from '../../src/runtime/tools.js';
import { parseComputerAction, parseComputerCommand } from '../../src/contracts/index.js';
import type { ComputerContext, ComputerFrame } from '../../src/contracts/index.js';
import { DesktopComputerBackend } from '../../src/main/backend.js';
import { ComputerSessionController } from '../../src/main/session-controller.js';
import { ComputerControlServer } from '../../src/main/control-server.js';
import { ComputerControlClient } from '../../src/runtime/control-client.js';
import { HelperComputerDriver } from '../../src/main/helper-driver.js';
const context: ComputerContext = { threadId: 'thread', turnId: 'turn', modelCapabilities: { supportsImages: true } };
const frame: ComputerFrame = { kind: 'frame', sessionId: 'session', observationId: 'observation', capturedAt: 1, coordinateSpace: 'screenshot-pixels', scope: 'primary-desktop', width: 100, height: 100, size: 3, dataUrl: 'data:image/png;base64,YWJj', capture: { backend: 'electron-desktop-capturer', sourceDisplayId: '1', nearBlackFraction: 0, transparentFraction: 0, contrast: 255, interiorContrast: 255 }, display: { id: 1, bounds: { x: 0, y: 0, width: 50, height: 50 }, scaleFactor: 2, inputBounds: { x: 0, y: 0, width: 50, height: 50 }, inputCoordinateSpace: 'macos-points' } };
describe('desktop runtime tools', () => {
  it('carries screenshot pixels through discovery, authenticated HTTP and the Windows native input boundary', async () => {
    const transport = { request: vi.fn(async (command: { kind: string }) => command.kind === 'start'
      ? { ready: true, integrityLevel: 12288 } : command.kind === 'end-session' ? { stopped: true } : { dispatched: true }), stop: vi.fn() };
    const driver = new HelperComputerDriver(undefined, transport);
    const { dataUrl, size, capture } = frame;
    const width = 1920; const height = 1080;
    const images = { capture: vi.fn(async () => ({ dataUrl, width, height, size, capture })) };
    const backend = new DesktopComputerBackend(driver, images, () => ({ ...frame.display,
      bounds: { x: 0, y: 0, width: 2048, height: 1152 }, scaleFactor: 1.25,
      inputBounds: { x: 0, y: 0, width: 2560, height: 1440 }, inputCoordinateSpace: 'windows-physical-pixels' }));
    const control = new ComputerSessionController(backend, {
      checkPermissions: vi.fn(), registerStop: vi.fn(async () => undefined), unregisterStop: vi.fn(), showControl: vi.fn(async () => undefined), prepareInput: vi.fn(),
    });
    const server = new ComputerControlServer({ execute: (command, signal) => control.execute(command, signal), isEnabled: async () => true });
    const { url, token } = await server.start();
    const tools = new ComputerRuntimeTools(new ComputerControlClient(url, token));
    try {
      const discovered = await tools.runTool('computer_windows', {}, context);
      const discovery = JSON.parse(discovered.content);
      expect(discovered.data).toEqual({ kind: 'windows', mode: 'foreground-desktop' });
      expect(discovery).not.toHaveProperty('windows');
      expect(discovery.nextStep).toEqual({ tool: 'computer_start', arguments: {} });
      expect(transport.request).not.toHaveBeenCalled();
      expect(images.capture).not.toHaveBeenCalled();

      const started = await tools.runTool(discovery.nextStep.tool, discovery.nextStep.arguments, context);
      expect(JSON.parse(started.content)).toMatchObject({ scope: 'primary-desktop', width, height, coordinateSpace: 'screenshot-pixels' });
      expect(started.attachments?.[0]).toMatchObject({ name: 'desktop-screenshot.png', url: dataUrl });
      expect(control.status()).toEqual({ active: true, threadId: context.threadId });
      let observation = JSON.parse(started.content);
      // The native helper alone owns image-to-display scaling, for both click
      // and scroll. Values above 1000 are ordinary pixels in a larger image.
      for (const action of [
        { kind: 'click', x: 680, y: 289 },
        { kind: 'scroll', x: 1200, y: 960, direction: 'down', amount: 2 },
      ] as const) {
        const args = { sessionId: observation.sessionId, observationId: observation.observationId, action };
        const calls = transport.request.mock.calls.length;
        await expect(tools.runTool('computer_action', { ...args, coordinateSpace: 'normalized-1000' }, context)).rejects.toThrow('Unsupported computer-use field');
        expect(transport.request).toHaveBeenCalledTimes(calls);
        const output = await tools.runTool('computer_action', args, context);
        expect(transport.request).toHaveBeenLastCalledWith({ kind: 'action', action,
          frame: { width, height, screenWidth: 2560, screenHeight: 1440 } }, expect.any(AbortSignal));
        observation = JSON.parse(output.content);
        expect(observation.inputDispatched).toBe(true);
      }
      await tools.cleanupTurn(context);
      expect(control.status()).toEqual({ active: false });
    } finally {
      await control.stop();
      await server.stop();
    }
  });
  it('keeps an empty macOS window enumeration distinct from Windows desktop discovery', async () => {
    const execute = vi.fn(async () => ({ kind: 'windows' as const, mode: 'background-window' as const, windows: [] }));
    const tools = new ComputerRuntimeTools({ execute, isEnabled: async () => true });
    const result = JSON.parse((await tools.runTool('computer_windows', {}, context)).content);
    expect(result).toEqual({ kind: 'windows', mode: 'background-window', windows: [] });
  });
  it('preserves explicit modifier chords and rejects malformed keys before native input', () => {
    expect(parseComputerAction({ kind: 'key', key: 'N', modifiers: ['Meta', 'Shift'] })).toEqual({ kind: 'key', key: 'n', modifiers: ['Meta', 'Shift'] });
    for (const action of [
      { kind: 'key', key: 'n', modifiers: ['Meta', 'Meta'] },
      { kind: 'key', key: 'n', modifiers: ['command'] },
      { kind: 'key', key: 'n', modifiers: 'Meta' },
    ]) expect(() => parseComputerAction(action)).toThrow('modifiers');
  });
  it('exposes only screenshot dimensions to the model while retaining native geometry for dispatch', async () => {
    const window = { id: 'window', pid: 1, windowNumber: 2, application: 'Notes', title: '', bounds: { x: 615, y: 274, width: 1000, height: 660 } };
    const result = { ...frame, scope: 'window' as const, window, width: 2000, height: 1320 };
    const execute = vi.fn().mockResolvedValueOnce({ kind: 'windows', mode: 'background-window', windows: [window] }).mockResolvedValue(result);
    const tools = new ComputerRuntimeTools({ execute, isEnabled: async () => true });
    const list = JSON.parse((await tools.runTool('computer_windows', {}, context)).content);
    expect(list.windows).toEqual([{ id: 'window', application: 'Notes', title: '' }]);
    const output = await tools.runTool('computer_start', { windowId: 'window' }, context);
    const observation = JSON.parse(output.content);
    expect(observation).toMatchObject({ width: 2000, height: 1320, coordinateSpace: 'screenshot-pixels' });
    expect(observation.window).toEqual({ id: 'window', application: 'Notes', title: '' });
    expect(observation).not.toHaveProperty('display');
    expect(output.attachments?.[0]?.url).toBe(result.dataUrl);
  });
  it('omits desktop tools without disrupting other tools when the control service is unavailable', async () => {
    const tools = new ComputerRuntimeTools({ execute: vi.fn(), isEnabled: async () => { throw new Error('offline'); } });
    expect(await tools.listTools(context)).toEqual([]);
  });
  it.each([{ readOnly: true }, { modelCapabilities: { supportsImages: false } }])('does not advertise or execute for %s', async (patch) => {
    const execute = vi.fn(); const tools = new ComputerRuntimeTools({ execute, isEnabled: async () => true }); const restricted = { ...context, ...patch };
    expect(await tools.listTools(restricted)).toEqual([]);
    await expect(tools.runTool('computer_start', { unattended: false }, restricted)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('advertises and executes desktop tools for scheduled turns through the same control port', async () => {
    const execute = vi.fn(async () => frame); const tools = new ComputerRuntimeTools({ execute, isEnabled: async () => true });
    const scheduled = { ...context, unattended: true };
    expect((await tools.listTools(scheduled)).map((tool) => tool.name)).toContain('computer_start');
    await tools.runTool('computer_start', {}, scheduled);
    expect(execute).toHaveBeenCalledWith({ kind: 'start', identity: expect.objectContaining({ unattended: true }) }, undefined);
  });
  it('takes turn identity from runtime context, never model arguments, and uses the existing image attachment pipeline', async () => {
    const execute = vi.fn(async () => frame); const tools = new ComputerRuntimeTools({ execute, isEnabled: async () => true });
    const result = await tools.runTool('computer_start', { identity: { unattended: false, threadId: 'forged' } }, context);
    expect(execute.mock.calls[0]?.[0]).toEqual({ kind: 'start', identity: { threadId: 'thread', turnId: 'turn', unattended: false, readOnly: false, supportsImages: true } });
    expect(result.containsExternalContext).toBe(true); expect(result.attachments?.[0]?.url).toBe(frame.dataUrl);
    expect(result.content).not.toContain('base64'); expect(result.data).not.toHaveProperty('dataUrl');
  });
  it('revokes on malformed image output even when the turn signal was cancelled', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ ...frame, dataUrl: '' }).mockResolvedValue({ kind: 'stopped' });
    const tools = new ComputerRuntimeTools({ execute, isEnabled: async () => true }); const signal = AbortSignal.abort();
    await expect(tools.runTool('computer_start', {}, { ...context, signal })).rejects.toThrow('image');
    expect(execute.mock.calls[1]).toEqual([{ kind: 'stop', identity: expect.objectContaining({ turnId: 'turn' }), reason: 'image-invalid' }]);
  });
  it('rejects arbitrary driver operations, invalid coordinates and absent trusted flags', () => {
    const identity = { threadId: 't', turnId: 'u', unattended: false, readOnly: false, supportsImages: true };
    for (const action of [{ kind: 'shell', command: 'x' }, { kind: 'click', x: -1, y: 0 }, { kind: 'click', x: NaN, y: 0 }, { kind: 'key', key: 'Meta+R' }]) {
      expect(() => parseComputerCommand({ kind: 'action', identity, sessionId: 's', observationId: 'o', action })).toThrow();
    }
    expect(() => parseComputerCommand({ kind: 'start', identity: { threadId: 't', turnId: 'u' } })).toThrow();
  });
});
