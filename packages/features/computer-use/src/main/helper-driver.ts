import { app } from 'electron';
import path from 'node:path';
import { parseComputerAction, type ComputerAction, type WindowsInputRequest } from '../contracts/index.js';
import { record } from '../contracts/validation.js';
import type { ComputerAdministratorAccess, ComputerDriver, DesktopInputFrame } from './backend.js';
import { ComputerProcess } from './computer-process.js';

type InputTransport = Pick<ComputerProcess, 'request' | 'stop'>;

/** Only the native input helper can elevate; Electron and the agent remain unchanged. */
export class HelperComputerDriver implements ComputerDriver, ComputerAdministratorAccess {
  private readonly transport: InputTransport;
  private authorized = false;
  private active = false;
  private pending = 0;
  constructor(onExit: () => void = () => undefined, transport?: InputTransport) {
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, 'computer-use', 'setsuna-computer-win.exe')
      : path.join(app.getAppPath(), 'dist', 'computer-use', 'windows', process.arch, 'setsuna-computer-win.exe');
    this.transport = transport ?? new ComputerProcess(executable, () => { this.authorized = false; this.active = false; onExit(); });
  }
  private async request(command: WindowsInputRequest, signal: AbortSignal): Promise<unknown> {
    this.pending++;
    try { return await this.transport.request(command, signal); }
    finally { this.pending--; }
  }
  isAuthorized(): boolean { return this.authorized; }
  async authorize(signal: AbortSignal): Promise<void> {
    if (this.authorized) return;
    try {
      const result = record(await this.request({ kind: 'authorize' }, signal));
      signal.throwIfAborted();
      if (result.authorized !== true || typeof result.integrityLevel !== 'number' || result.integrityLevel < 0x3000) throw new Error('Windows did not confirm administrator access.');
      this.authorized = true;
    } catch (error) { await this.revoke(); throw error; }
  }
  async probe(): Promise<unknown> {
    try { return await this.request({ kind: 'probe' }, AbortSignal.timeout(15_000)); }
    finally { await this.revoke(); }
  }
  async start(_sessionId: string, signal: AbortSignal): Promise<void> {
    // Request access before the first screenshot/input. The broker reuses its
    // elevated helper on later sessions, whether granted here or in Settings.
    const result = record(await this.request({ kind: 'start', elevate: true }, signal));
    signal.throwIfAborted();
    if (result.ready !== true) throw new Error('Windows input helper did not start.');
    if (typeof result.integrityLevel !== 'number' || result.integrityLevel < 0x3000) throw new Error('Windows input helper did not confirm administrator access.');
    this.authorized = true;
    this.active = true;
  }
  async action(action: ComputerAction, frame: DesktopInputFrame, signal: AbortSignal): Promise<void> {
    const bounds = frame.display.inputBounds;
    if (frame.display.inputCoordinateSpace !== 'windows-physical-pixels' || bounds.x !== 0 || bounds.y !== 0) {
      throw new Error('Windows input requires the authorized primary display.');
    }
    const result = record(await this.request({ kind: 'action', action: parseComputerAction(action),
      frame: { width: frame.width, height: frame.height, screenWidth: bounds.width, screenHeight: bounds.height } }, signal));
    if (result.dispatched !== true) throw new Error('Windows did not confirm input dispatch.');
  }
  async stop(reason?: string): Promise<void> {
    // A normal turn ending disarms input but retains the grant across sessions.
    // Cancellation, errors, lock and app/runtime exit revoke the grant.
    if (this.authorized && !this.pending && (reason === 'requested' || reason === 'turn-cleanup')) {
      if (!this.active) return;
      try {
        const result = record(await this.request({ kind: 'end-session' }, AbortSignal.timeout(2000)));
        if (result.stopped !== true) throw new Error('Windows did not confirm input release.');
        this.active = false;
        return;
      } catch (error) { await this.revoke(); throw error; }
    }
    await this.revoke();
  }
  revoke(): Promise<void> {
    this.authorized = false;
    this.active = false;
    return this.transport.stop();
  }
}
