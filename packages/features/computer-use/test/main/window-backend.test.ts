import { afterEach, describe, expect, it, vi } from 'vitest';
import { MacWindowBackend } from '../../src/main/window-backend.js';
import { ComputerSessionController } from '../../src/main/session-controller.js';
import { StaleComputerObservationError } from '../../src/main/backend.js';
import { ComputerControlServer } from '../../src/main/control-server.js';
import { ComputerControlClient } from '../../src/runtime/control-client.js';
import { ComputerRuntimeTools } from '../../src/runtime/tools.js';
import type { ComputerFrame, ComputerIdentity, ComputerWindow } from '../../src/contracts/index.js';

const window: ComputerWindow = { id: '8:12:4000', pid: 8, windowNumber: 12, application: 'Fixture', title: 'Document', bounds: { x: 300, y: 200, width: 400, height: 300 } };
const identity: ComputerIdentity = { threadId: 't', turnId: 'r', unattended: false, readOnly: false, supportsImages: true };
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function fixture() {
  const image = { scope: 'window' as const, window, width: 800, height: 600, size: 3, dataUrl: 'data:image/png;base64,YWJj', capture: { backend: 'macos-window' as const, sourceWindowId: window.id } };
  const transport = {
    request: vi.fn(async (command: object, _signal: AbortSignal): Promise<unknown> => {
      switch ((command as { kind: string }).kind) {
        case 'windows': return [window];
        case 'start': return window;
        case 'capture': return image;
        case 'action': return { dispatched: true };
        default: throw new Error('Unexpected native command');
      }
    }),
    stop: vi.fn(async () => undefined),
  };
  const backend = new MacWindowBackend(transport);
  const controller = new ComputerSessionController(backend, { checkPermissions() {}, registerStop: async () => undefined, unregisterStop() {}, showControl: async () => undefined, prepareInput() {} });
  cleanups.push(() => controller.stop());
  const start = () => controller.execute({ kind: 'start', windowId: window.id, identity }) as Promise<ComputerFrame>;
  return { image, transport, backend, controller, start };
}

describe('background window sessions', () => {
  it.each([{ threadId: 'other-thread' }, { turnId: 'other-turn' }])('keeps another task’s discovery cancellation away from the active helper: %s', async (other) => {
    const f = fixture(); const frame = await f.start();
    const abort = new AbortController();
    await expect(f.controller.execute({ kind: 'windows', identity: { ...identity, ...other } }, abort.signal)).rejects.toThrow('another turn');
    abort.abort();
    expect(f.transport.request.mock.calls.map(([command]) => (command as { kind: string }).kind)).toEqual(['start', 'capture']);
    expect(f.transport.stop).not.toHaveBeenCalled();
    expect(f.controller.status()).toEqual({ active: true, threadId: identity.threadId });
    await expect(f.controller.execute({ kind: 'windows', identity })).resolves.toMatchObject({ windows: [window] });
    await expect(f.controller.execute({ kind: 'action', identity, sessionId: frame.sessionId, observationId: frame.observationId, action: { kind: 'key', key: 'Enter' } })).resolves.toMatchObject({ inputDispatched: true });
  });

  it('revokes the session when its own in-flight discovery is cancelled', async () => {
    const f = fixture(); await f.start();
    let discoverySignal: AbortSignal | undefined;
    f.transport.request.mockImplementationOnce(async (_command, signal) => {
      discoverySignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const abort = new AbortController();
    const pending = f.controller.execute({ kind: 'windows', identity }, abort.signal);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(discoverySignal).toBeDefined());
    abort.abort(new Error('turn cancelled'));
    expect(f.controller.status().active).toBe(false);
    await rejected;
    expect(f.transport.stop).toHaveBeenCalled();
    await expect(f.start()).resolves.toMatchObject({ kind: 'frame' });
  });

  it('carries discovery, target choice and window-only attachments through runtime and authenticated HTTP', async () => {
    const f = fixture();
    const server = new ComputerControlServer({ execute: (command, signal) => f.controller.execute(command, signal), isEnabled: async () => true });
    const { url, token } = await server.start(); cleanups.push(() => server.stop());
    const tools = new ComputerRuntimeTools(new ComputerControlClient(url, token));
    const context = { threadId: 't', turnId: 'r', modelCapabilities: { supportsImages: true } };
    const windows = await tools.runTool('computer_windows', {}, context);
    expect(windows.data).toEqual({ kind: 'windows', mode: 'background-window', windows: [window] });
    expect(windows.containsExternalContext).toBe(true);
    expect(windows.attachments).toBeUndefined();
    expect(f.transport.stop).toHaveBeenCalledOnce();
    expect(f.controller.status().active).toBe(false);
    const result = await tools.runTool('computer_start', { windowId: window.id }, context);
    expect(result.data).toMatchObject({ scope: 'window', window });
    expect(result.data).not.toHaveProperty('display');
    expect(result.attachments?.[0]?.name).toBe('window-screenshot.png');
    expect(f.transport.request).toHaveBeenCalledWith({ kind: 'start', windowId: window.id }, expect.any(AbortSignal));
    const frame = result.data as ComputerFrame;
    const action = { kind: 'click' as const, x: 150, y: 500 };
    await tools.runTool('computer_action', { observationId: frame.observationId, action }, context);
    expect(f.transport.request).toHaveBeenCalledWith({ kind: 'action', action, frame: { window, width: 800, height: 600 } }, expect.any(AbortSignal));
    await tools.cleanupTurn(context);
    expect(f.controller.status().active).toBe(false);
  });

  it('never starts a global session when macOS is called without a window', async () => {
    const f = fixture();
    await expect(f.controller.execute({ kind: 'start', identity })).rejects.toThrow('computer_windows');
    expect(f.transport.request).not.toHaveBeenCalled();
  });

  it('rejects screenshots from a sibling window and revokes the session', async () => {
    const f = fixture();
    f.transport.request.mockImplementation(async (command) => (command as { kind: string }).kind === 'start'
      ? window : { ...f.image, window: { ...window, id: '8:13:4000', windowNumber: 13 } });
    await expect(f.start()).rejects.toThrow('belong');
    expect(f.controller.status().active).toBe(false);
    expect(f.transport.stop).toHaveBeenCalledOnce();
  });

  it('binds a moved window to the next observation and never sends unobserved geometry', async () => {
    const f = fixture(); const first = await f.start();
    const moved = { ...window, bounds: { ...window.bounds, x: 600 } };
    f.transport.request.mockResolvedValueOnce({ ...f.image, window: moved });
    const frame = await f.controller.execute({ kind: 'screenshot', identity, sessionId: first.sessionId }) as ComputerFrame;
    await f.controller.execute({ kind: 'action', identity, sessionId: frame.sessionId, observationId: frame.observationId, action: { kind: 'key', key: 'Enter' } });
    expect(f.transport.request).toHaveBeenCalledWith(expect.objectContaining({ kind: 'action', frame: { window: moved, width: 800, height: 600 } }), expect.any(AbortSignal));
  });

  it('does not retry through another input path when the native target rejects an action', async () => {
    const f = fixture(); const frame = await f.start();
    f.transport.request.mockRejectedValueOnce(new Error('Window moved; fresh screenshot required'));
    const count = f.transport.request.mock.calls.length;
    await expect(f.controller.execute({ kind: 'action', identity, sessionId: frame.sessionId, observationId: frame.observationId, action: { kind: 'click', x: 0, y: 0 } })).rejects.toThrow('Window moved');
    expect(f.transport.request).toHaveBeenCalledTimes(count + 1);
    expect(f.controller.status().active).toBe(false);
  });

  it('refreshes changed geometry through HTTP without replaying input or losing the session', async () => {
    const f = fixture();
    const server = new ComputerControlServer({ execute: (command, signal) => f.controller.execute(command, signal), isEnabled: async () => true });
    const { url, token } = await server.start(); cleanups.push(() => server.stop());
    const tools = new ComputerRuntimeTools(new ComputerControlClient(url, token));
    const context = { threadId: 't', turnId: 'r', modelCapabilities: { supportsImages: true } };
    const first = (await tools.runTool('computer_start', { windowId: window.id }, context)).data as ComputerFrame;
    const moved = { ...window, bounds: { ...window.bounds, x: 640 } };
    f.transport.request.mockRejectedValueOnce(new StaleComputerObservationError('Window moved. No input was sent.'))
      .mockResolvedValueOnce({ ...f.image, window: moved });
    const action = { kind: 'key', key: 'n', modifiers: ['Meta'] };
    const recovered = await tools.runTool('computer_action', { observationId: first.observationId, action }, context);
    const frame = recovered.data as ComputerFrame;
    expect(JSON.parse(recovered.content)).toMatchObject({ inputDispatched: false, actionError: expect.stringContaining('Window moved') });
    expect(frame.observationId).not.toBe(first.observationId);
    expect(f.controller.status().active).toBe(true);
    expect(f.transport.stop).not.toHaveBeenCalled();
    const after = await tools.runTool('computer_action', { observationId: frame.observationId, action }, context);
    expect(after.data).toMatchObject({ inputDispatched: true });
    expect(f.transport.request).toHaveBeenCalledWith({ kind: 'action', action, frame: { window: moved, width: 800, height: 600 } }, expect.any(AbortSignal));
    expect(f.transport.request.mock.calls.filter(([command]) => (command as { kind: string }).kind === 'action')).toHaveLength(2);
  });

  it('rejects forged target identity before native input and supports an explicit stop/start window switch', async () => {
    const f = fixture(); const frame = await f.start();
    await expect(f.backend.action({ kind: 'key', key: 'Enter' }, { ...frame, scope: 'window', window: { ...window, pid: 99 } }, new AbortController().signal)).rejects.toThrow('belong');
    await f.controller.stop();
    const next = { ...window, id: '8:13:4000', windowNumber: 13 };
    f.transport.request.mockResolvedValueOnce(next).mockResolvedValueOnce({ ...f.image, window: next, capture: { backend: 'macos-window', sourceWindowId: next.id } });
    await expect(f.controller.execute({ kind: 'start', identity, windowId: next.id })).resolves.toMatchObject({ window: next });
  });
});
