import { describe, expect, it, vi } from 'vitest';
import { ComputerRuntimeTools } from '../../src/runtime/tools.js';
import { parseComputerAction, parseComputerCommand } from '../../src/contracts/index.js';
import type { ComputerContext, ComputerFrame } from '../../src/contracts/index.js';
const context: ComputerContext = { threadId: 'thread', turnId: 'turn', modelCapabilities: { supportsImages: true } };
const frame: ComputerFrame = { kind: 'frame', sessionId: 'session', observationId: 'observation', capturedAt: 1, coordinateSpace: 'screenshot-pixels', scope: 'primary-desktop', width: 100, height: 100, size: 3, dataUrl: 'data:image/png;base64,YWJj', capture: { backend: 'electron-desktop-capturer', sourceDisplayId: '1', nearBlackFraction: 0, transparentFraction: 0, contrast: 255, interiorContrast: 255 }, display: { id: 1, bounds: { x: 0, y: 0, width: 50, height: 50 }, scaleFactor: 2, inputBounds: { x: 0, y: 0, width: 50, height: 50 }, inputCoordinateSpace: 'macos-points' } };
describe('desktop runtime tools', () => {
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
