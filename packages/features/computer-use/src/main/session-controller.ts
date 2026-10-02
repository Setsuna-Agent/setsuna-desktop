import { randomUUID } from 'node:crypto';
import type { ComputerCommand, ComputerFrame, ComputerIdentity, ComputerPreview, ComputerPreviewFrame, ComputerResult, ComputerStatus, ComputerTarget } from '../contracts/index.js';
import type { ComputerDiagnostic } from './diagnostics.js';
import { StaleComputerObservationError, type ComputerBackend } from './backend.js';

export function isUserComputerStop(reason: string): boolean {
  return ['user-stop', 'emergency-shortcut', 'settings-disabled'].includes(reason);
}

export interface ComputerSupervisor {
  checkPermissions(): void;
  registerStop(stop: (reason?: string) => void): Promise<void>;
  unregisterStop(): void;
}
type Session = {
  id: string; identity: ComputerIdentity; target?: ComputerTarget;
  abort: AbortController; frame?: ComputerFrame;
  preview?: ComputerPreviewFrame;
  phase?: string; run?: number;
};

/** One main-process owner serializes every thread, including startup and capture. */
export class ComputerSessionController {
  private epoch = 0;
  private session: Session | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private stopping: Promise<void> = Promise.resolve();
  private lastStopReason: string | undefined;
  private nextRun = 0;
  private readonly revokedTurns = new Map<string, string>();
  constructor(private readonly backend: ComputerBackend, private readonly supervisor: ComputerSupervisor, private readonly now = Date.now, private readonly onStopped: (reason: string, identity: ComputerIdentity) => void | Promise<void> = () => undefined, private readonly diagnostic: (event: ComputerDiagnostic) => void = () => undefined) {}

  private trace(event: ComputerDiagnostic): void {
    try { this.diagnostic(event); }
    catch { /* Diagnostics must never change execution or cleanup. */ }
  }

  status(): ComputerStatus {
    const current = this.session;
    return current ? { active: true, threadId: current.identity.threadId } : { active: false };
  }
  preview(): ComputerPreview {
    return { ...this.status(), frame: this.session?.preview ?? null };
  }
  stop(reason = 'requested'): Promise<void> {
    this.epoch++;
    const current = this.session;
    this.session = undefined; // Revoke admission before waiting for an in-flight native call.
    if (current) {
      if (isUserComputerStop(reason)) this.revokedTurns.set(current.identity.threadId, current.identity.turnId);
      this.lastStopReason = reason;
      this.trace({ event: 'stopped', reason, run: current.run, phase: current.phase, active: false });
    }
    current?.abort.abort(new Error('Desktop control stopped.'));
    this.supervisor.unregisterStop();
    this.stopping = this.stopping.then(() => this.backend.stop());
    let notified: void | Promise<void> = undefined;
    if (current) {
      try { notified = this.onStopped(reason, current.identity); }
      catch (error) { notified = Promise.reject(error); }
    }
    // Runtime cancellation can trigger cleanup back into stop(). Only native shutdown
    // joins the controller queue, so that cleanup never waits on its own cancellation.
    return Promise.all([this.stopping, notified]).then(() => undefined);
  }
  execute(command: ComputerCommand, signal: AbortSignal = new AbortController().signal): Promise<ComputerResult> {
    const runId = ++this.nextRun;
    this.trace({ event: 'command', run: runId, command: command.kind, phase: 'received', active: Boolean(this.session), ownerMatches: this.owns(command.identity), sessionMatches: 'sessionId' in command ? this.session?.id === command.sessionId : undefined, signalAborted: signal.aborted });
    if (command.kind === 'stop') {
      if (!this.session || this.owns(command.identity)) return this.stop(command.reason).then(() => ({ kind: 'stopped' }));
      this.trace({ event: 'rejected', run: runId, reason: 'owner-mismatch' });
      return Promise.reject(new Error('Desktop session belongs to another turn.'));
    }
    const epoch = this.epoch;
    const run = this.queue.then(async () => {
      await this.stopping;
      signal.throwIfAborted();
      if (epoch !== this.epoch) throw new Error('Queued desktop command cancelled.');
      return this.run(command, signal, runId);
    });
    void run.catch(() => this.trace({ event: 'rejected', run: runId, command: command.kind, reason: this.lastStopReason ?? 'admission-or-operation-failed', signalAborted: signal.aborted }));
    this.queue = run.catch(() => undefined);
    return run;
  }
  private owns(identity: ComputerIdentity): boolean {
    return this.session?.identity.threadId === identity.threadId && this.session.identity.turnId === identity.turnId;
  }
  private async run(command: Exclude<ComputerCommand, { kind: 'stop' }>, signal: AbortSignal, runId: number): Promise<ComputerResult> {
    signal.throwIfAborted();
    const identity = command.identity;
    if (this.revokedTurns.get(identity.threadId) === identity.turnId) throw new Error('Computer control was stopped by the user. Do not restart or use another input tool in this turn. Wait for a new user request.');
    if (identity.readOnly || !identity.supportsImages) throw new Error('Desktop control requires a writable turn and an image-capable model.');
    if (command.kind === 'windows') {
      // Discovery uses the same native helper as input; a different turn must not
      // acquire a cancellation signal that can shut down the current owner's helper.
      if (this.session && !this.owns(identity)) throw new Error('Desktop session belongs to another turn.');
      if (!this.session) {
        this.supervisor.checkPermissions();
        return this.backend.windows(AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
      }
    }
    if (command.kind !== 'start' && command.kind !== 'windows' && (!this.owns(identity) || !('sessionId' in command) || this.session?.id !== command.sessionId)) throw new Error(`No authorized desktop session for this turn.${!this.session && this.lastStopReason ? ` Last stop: ${this.lastStopReason}.` : ''}`);
    if (command.kind === 'start' && this.session) throw new Error('A desktop session already owns the global controller.');
    let session = this.session;
    if (command.kind === 'start') {
      this.supervisor.checkPermissions();
      session = { id: randomUUID(), identity, abort: new AbortController() };
      this.session = session; // Reserve the desktop while the driver starts; approval is owned by runtime.
      this.lastStopReason = undefined;
    }
    if (!session) throw new Error('Desktop session is closed.');
    const current = session;
    const startedAt = this.now();
    current.run = runId;
    current.phase = 'admission';
    const abort = () => {
      const cause = operationSignal.reason;
      const reason = cause?.name === 'TimeoutError' ? 'command-timeout' : cause?.message === 'transport-disconnected' ? 'transport-disconnected' : 'command-cancelled';
      if (this.session === current) void this.stop(reason).catch(() => undefined);
    };
    signal.addEventListener('abort', abort, { once: true });
    const operationSignal = AbortSignal.any([signal, current.abort.signal, AbortSignal.timeout(30_000)]);
    operationSignal.addEventListener('abort', abort, { once: true });
    try {
      if (command.kind === 'start') {
        current.phase = 'supervisor';
        await this.supervisor.registerStop((reason) => { if (this.session === current) void this.stop(reason ?? 'supervisor-stop').catch(() => undefined); });
        this.trace({ event: 'supervisor-ready', run: runId });
        operationSignal.throwIfAborted();
        current.phase = 'driver-start';
        current.target = await this.backend.start(current.id, command.windowId, operationSignal);
      }
      current.phase = 'session-validity';
      operationSignal.throwIfAborted();
      if (this.session !== current) throw new Error('Desktop session is closed.');
      current.phase = 'permissions';
      this.supervisor.checkPermissions();
      if (command.kind === 'windows') {
        current.phase = 'window-discovery';
        const windows = await this.backend.windows(operationSignal);
        operationSignal.throwIfAborted();
        return windows;
      }
      const previous = current.frame;
      current.frame = undefined; // Consume observations even if capture or image delivery later fails.
      let actionError: string | undefined;
      if (command.kind === 'action') {
        current.phase = 'observation-validation';
        try {
          if (!previous || command.observationId !== previous.observationId || this.now() - previous.capturedAt > 30_000) throw new StaleComputerObservationError('The observation is stale. Use the returned screenshot and observationId.');
          if ('x' in command.action && (command.action.x >= previous.width || command.action.y >= previous.height)) throw new StaleComputerObservationError('Coordinates are outside the screenshot. Choose coordinates within its width and height.');
          current.phase = 'input';
          await this.backend.action(command.action, previous, operationSignal);
        } catch (error) {
          // Only failures known to precede input may refresh in-place. Never replay
          // an action automatically, especially text that may already be partly typed.
          if (!(error instanceof StaleComputerObservationError)) throw error;
          actionError = error.message;
        }
      }
      operationSignal.throwIfAborted();
      current.phase = 'capture';
      this.trace({ event: 'capture-before', run: runId, elapsedMs: this.now() - startedAt });
      operationSignal.throwIfAborted();
      if (!current.target) throw new Error('Computer target is unavailable.');
      const image = await this.backend.capture(current.target, operationSignal);
      operationSignal.throwIfAborted();
      current.phase = 'image-validation';
      if (!image.dataUrl.startsWith('data:image/png;base64,') || image.width <= 0 || image.height <= 0 || image.size <= 0) throw new Error('Desktop image validation failed.');
      const frame: ComputerFrame = {
        ...image, kind: 'frame', sessionId: current.id, observationId: randomUUID(), capturedAt: this.now(),
        coordinateSpace: 'screenshot-pixels',
        ...(command.kind === 'action' ? { inputDispatched: !actionError, ...(actionError ? { actionError } : {}) } : {}),
      };
      current.frame = frame;
      // Keep the last visible image while input consumes its observation; preview never captures or authorizes input.
      current.preview = { dataUrl: frame.dataUrl, width: frame.width, height: frame.height, observationId: frame.observationId };
      current.phase = 'observation-ready';
      this.trace({ event: 'capture-after', run: runId, elapsedMs: this.now() - startedAt, width: frame.width, height: frame.height, displayId: frame.scope === 'primary-desktop' ? frame.display.id : undefined });
      operationSignal.throwIfAborted();
      return frame;
    } catch (error) {
      if (this.session === current) await this.stop(`${current.phase}-failed`);
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      operationSignal.removeEventListener('abort', abort);
    }
  }
}
