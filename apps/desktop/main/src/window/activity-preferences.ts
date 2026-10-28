import { DEFAULT_DESKTOP_ACTIVITY_PREFERENCES, parseDesktopActivityPreferences, type DesktopActivityPreferences } from '@setsuna-desktop/contracts';
import { readFile } from 'node:fs/promises';
import { writeJsonAtomically } from '../data-root/atomic-json.js';

type Options = {
  filePath: string;
  power: { start(type: 'prevent-app-suspension'): number; stop(id: number): void };
  shortcuts: { register(accelerator: string, callback: () => void): boolean; unregister(accelerator: string): void };
  onSummon(): void;
};

/** Owns exactly one blocker and one shortcut; independent of renderer/window lifetime. */
export class DesktopActivityPreferencesController {
  private value = DEFAULT_DESKTOP_ACTIVITY_PREFERENCES;
  private loading: Promise<void> | null = null;
  private writing: Promise<unknown> = Promise.resolve();
  private activeTurns = 0;
  private blocker: number | null = null;
  private disposed = false;
  private pendingShortcut: string | null = null;
  constructor(private readonly options: Options) {}

  initialize(): Promise<void> {
    return this.loading ??= (async () => {
      const stored = await readFile(this.options.filePath, 'utf8').then((json) => parseDesktopActivityPreferences(JSON.parse(json))).catch(() => DEFAULT_DESKTOP_ACTIVITY_PREFERENCES);
      if (this.disposed) return;
      this.value = { ...stored, summonShortcut: 'disabled' };
      // A shortcut may be occupied after a restart; leave it available for a deliberate retry.
      if (stored.summonShortcut !== 'disabled' && this.options.shortcuts.register(stored.summonShortcut, this.options.onSummon)) this.value = stored;
      this.syncPower();
    })();
  }
  async get(): Promise<DesktopActivityPreferences> { await this.initialize(); return this.value; }
  set(input: unknown): Promise<DesktopActivityPreferences> {
    const next = parseDesktopActivityPreferences(input);
    const operation = this.writing.then(async () => {
      await this.initialize();
      if (this.disposed) throw new Error('Desktop services have stopped.');
      const previous = this.value;
      const changed = next.summonShortcut !== previous.summonShortcut;
      if (changed && next.summonShortcut !== 'disabled' && !this.options.shortcuts.register(next.summonShortcut, this.options.onSummon)) throw new Error('Shortcut is already in use.');
      this.pendingShortcut = changed && next.summonShortcut !== 'disabled' ? next.summonShortcut : null;
      try {
        await writeJsonAtomically(this.options.filePath, next);
      } catch (error) {
        if (changed && next.summonShortcut !== 'disabled') this.options.shortcuts.unregister(next.summonShortcut);
        throw error;
      } finally {
        this.pendingShortcut = null;
      }
      if (changed && previous.summonShortcut !== 'disabled') this.options.shortcuts.unregister(previous.summonShortcut);
      if (this.disposed) {
        if (next.summonShortcut !== 'disabled') this.options.shortcuts.unregister(next.summonShortcut);
        throw new Error('Desktop services have stopped.');
      }
      this.value = next;
      this.syncPower();
      return next;
    });
    this.writing = operation.catch(() => undefined);
    return operation;
  }
  setActiveTurns(count: number): void {
    if (this.disposed) return;
    this.activeTurns = Math.max(0, count);
    this.syncPower();
  }
  dispose(): void {
    this.disposed = true;
    if (this.pendingShortcut) this.options.shortcuts.unregister(this.pendingShortcut);
    this.pendingShortcut = null;
    if (this.value.summonShortcut !== 'disabled') this.options.shortcuts.unregister(this.value.summonShortcut);
    this.activeTurns = 0;
    this.syncPower();
  }
  private syncPower(): void {
    if (!this.disposed && this.value.keepAwakeDuringTasks && this.activeTurns > 0) {
      this.blocker ??= this.options.power.start('prevent-app-suspension');
    } else if (this.blocker !== null) {
      this.options.power.stop(this.blocker);
      this.blocker = null;
    }
  }
}
