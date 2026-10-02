import type { ComputerAction, ComputerFrame, ComputerImage, ComputerTarget, ComputerWindow, ComputerWindows } from '../contracts/index.js';
import { record, string } from '../contracts/validation.js';
import type { ComputerBackend } from './backend.js';

export interface WindowTransport {
  request(command: object, signal: AbortSignal): Promise<unknown>;
  stop(): Promise<void>;
}

function windowRecord(value: unknown): ComputerWindow {
  const window = record(value); const bounds = record(window.bounds);
  for (const key of ['x', 'y', 'width', 'height']) {
    if (typeof bounds[key] !== 'number' || !Number.isFinite(bounds[key])) throw new Error('Invalid window geometry.');
  }
  if ((bounds.width as number) <= 0 || (bounds.height as number) <= 0 || !Number.isSafeInteger(window.pid) || !Number.isSafeInteger(window.windowNumber)) throw new Error('Invalid window identity.');
  return {
    id: string(window.id), pid: window.pid as number, windowNumber: window.windowNumber as number,
    application: string(window.application, 2000), title: typeof window.title === 'string' ? window.title : '',
    bounds: bounds as ComputerWindow['bounds'],
  };
}

/** A session selects exactly one window; captures never fall back to the desktop. */
export class MacWindowBackend implements ComputerBackend {
  private selected: ComputerWindow | undefined;
  constructor(private readonly transport: WindowTransport) {}
  async windows(signal: AbortSignal): Promise<ComputerWindows> {
    try {
      const values = await this.transport.request({ kind: 'windows' }, signal);
      if (!Array.isArray(values)) throw new Error('Invalid window list.');
      return { kind: 'windows', mode: 'background-window', windows: values.map(windowRecord) };
    } finally { if (!this.selected) await this.transport.stop(); }
  }
  async start(_sessionId: string, windowId: string | undefined, signal: AbortSignal): Promise<ComputerTarget> {
    if (!windowId) throw new Error('Call computer_windows, then pass the selected windowId to computer_start.');
    const window = windowRecord(await this.transport.request({ kind: 'start', windowId }, signal));
    signal.throwIfAborted();
    if (window.id !== windowId) throw new Error('Window helper selected a different target.');
    this.selected = window;
    return { scope: 'window', window };
  }
  private check(target: ComputerTarget): asserts target is Extract<ComputerTarget, { scope: 'window' }> {
    if (target.scope !== 'window' || !this.selected || target.window.id !== this.selected.id
      || target.window.pid !== this.selected.pid || target.window.windowNumber !== this.selected.windowNumber) throw new Error('Window does not belong to this session.');
  }
  async capture(target: ComputerTarget, signal: AbortSignal): Promise<ComputerImage & ComputerTarget> {
    this.check(target);
    const result = record(await this.transport.request({ kind: 'capture' }, signal));
    const window = windowRecord(result.window);
    this.check({ scope: 'window', window });
    const capture = record(result.capture);
    if (capture.backend !== 'macos-window' || capture.sourceWindowId !== window.id) throw new Error('Screenshot target does not match this window.');
    const dataUrl = string(result.dataUrl, 24_000_100);
    if (!dataUrl.startsWith('data:image/png;base64,') || !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height)
      || !Number.isSafeInteger(result.size) || (result.width as number) <= 0 || (result.height as number) <= 0
      || (result.width as number) > 32768 || (result.height as number) > 32768 || (result.size as number) <= 0 || (result.size as number) > 18_000_000) throw new Error('Invalid window screenshot.');
    return { scope: 'window', window, dataUrl, width: result.width as number, height: result.height as number,
      size: result.size as number, capture: { backend: 'macos-window', sourceWindowId: window.id } };
  }
  async action(action: ComputerAction, frame: ComputerFrame, signal: AbortSignal): Promise<void> {
    this.check(frame);
    const result = record(await this.transport.request({ kind: 'action', action,
      frame: { window: frame.window, width: frame.width, height: frame.height } }, signal));
    if (result.dispatched !== true) throw new Error('Background input was not dispatched.');
  }
  async stop(): Promise<void> { this.selected = undefined; await this.transport.stop(); }
}
