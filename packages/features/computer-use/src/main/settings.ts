import { readFile } from 'node:fs/promises';
import type { ComputerCommand, ComputerControlPort, ComputerPermissions, ComputerResult, ComputerSettings } from '../contracts/index.js';
import type { ComputerSessionController } from './session-controller.js';

/** Main owns the preference and admission, including calls already advertised to a model. */
export class ComputerSettingsService implements ComputerControlPort {
  private enabled = false;
  private revision = 0;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly configPath: string,
    private readonly control: Pick<ComputerSessionController, 'execute' | 'stop'>,
    private readonly writeConfig: (filePath: string, value: unknown) => Promise<void>,
    private readonly permissions: () => ComputerPermissions,
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

  settings(): ComputerSettings { return { enabled: this.enabled, permissions: this.permissions() }; }
  async isEnabled(): Promise<boolean> { return this.enabled; }

  async setEnabled(enabled: boolean): Promise<ComputerSettings> {
    if (typeof enabled !== 'boolean') throw new Error('Invalid desktop control setting.');
    const revision = ++this.revision;
    // Revoke synchronously, before disk I/O or any earlier settings write completes.
    // stop() also invalidates commands already queued inside the controller.
    if (!enabled) this.enabled = false;
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

  execute(command: ComputerCommand, signal?: AbortSignal): Promise<ComputerResult> {
    if (!this.enabled && command.kind !== 'stop') return Promise.reject(new Error('Desktop control is disabled. Enable it in Settings > Computer control.'));
    return this.control.execute(command, signal);
  }

  async flush(): Promise<void> { await this.writes; }
}
