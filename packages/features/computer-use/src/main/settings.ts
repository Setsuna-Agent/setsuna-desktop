import { readFile } from 'node:fs/promises';
import type { ComputerCommand, ComputerControlPort, ComputerPermissions, ComputerResult, ComputerSettings } from '../contracts/index.js';
import type { ComputerSessionController } from './session-controller.js';
import { ComputerElevationCancelledError, type ComputerAdministratorAccess } from './backend.js';
import { ComputerControlError } from '../contracts/index.js';

/** Main owns the preference and admission, including calls already advertised to a model. */
export class ComputerSettingsService implements ComputerControlPort {
  private enabled = false;
  private authorization: { abort: AbortController; promise: Promise<void> } | undefined;
  private revision = 0;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly configPath: string,
    private readonly control: Pick<ComputerSessionController, 'execute' | 'stop'>,
    private readonly writeConfig: (filePath: string, value: unknown) => Promise<void>,
    private readonly permissions: () => ComputerPermissions,
    private readonly administrator?: ComputerAdministratorAccess,
  ) {}

  async load(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(this.configPath, 'utf8'));
      this.enabled = typeof value === 'object' && value !== null && 'enabled' in value && value.enabled === true;
    } catch (error) {
      this.enabled = false;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[computer-use] Could not read settings; control is disabled.', error);
    }
  }

  settings(): ComputerSettings {
    return { enabled: this.enabled, permissions: { ...this.permissions(),
      ...(this.administrator ? { administrator: this.administrator.isAuthorized() ? 'granted' as const : 'not-determined' as const } : {}),
    } };
  }
  async isEnabled(): Promise<boolean> { return this.enabled; }

  async setEnabled(enabled: boolean): Promise<ComputerSettings> {
    if (typeof enabled !== 'boolean') throw new Error('Invalid desktop control setting.');
    const revision = ++this.revision;
    // Revoke synchronously, before disk I/O or any earlier settings write completes.
    // stop() also invalidates commands already queued inside the controller.
    if (!enabled) { this.enabled = false; this.authorization?.abort.abort(new Error('Desktop control disabled.')); }
    const stopped = enabled ? Promise.resolve() : this.control.stop('settings-disabled');
    const written = this.writes.then(async () => {
      await this.writeConfig(this.configPath, { enabled });
      // A slow enable must never undo a more recent disable from another window.
      if (revision === this.revision) this.enabled = enabled;
    });
    this.writes = written.catch(() => undefined);
    await Promise.all([written, stopped]);
    return this.settings();
  }

  requestAdministratorAccess(): Promise<void> {
    const administrator = this.administrator;
    if (!administrator) return Promise.reject(new Error('Administrator access is only available on Windows.'));
    if (this.authorization) return this.authorization.promise;
    if (administrator.isAuthorized()) return Promise.resolve();
    const abort = new AbortController();
    const promise = (async () => {
      // Authorization owns the helper while UAC is pending, but opens no input
      // session. Stop an existing turn before changing its native transport.
      await this.control.stop('administrator-authorization');
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]);
      signal.throwIfAborted();
      try { await administrator.authorize(signal); }
      catch (error) { if (!(error instanceof ComputerElevationCancelledError)) throw error; }
    })().finally(() => { if (this.authorization?.abort === abort) this.authorization = undefined; });
    this.authorization = { abort, promise };
    return promise;
  }

  execute(command: ComputerCommand, signal?: AbortSignal): Promise<ComputerResult> {
    if (!this.enabled && command.kind !== 'stop') return Promise.reject(new ComputerControlError({ code: 'control-unavailable', sessionState: 'closed', message: 'Desktop control is disabled. Enable it in Settings > Computer control.' }));
    if (this.authorization && command.kind !== 'stop') return Promise.reject(new ComputerControlError({ code: 'control-unavailable', sessionState: 'closed', message: 'Administrator authorization is in progress. Wait until it completes.' }));
    return this.control.execute(command, signal);
  }

  async flush(): Promise<void> { await this.writes; }
}
