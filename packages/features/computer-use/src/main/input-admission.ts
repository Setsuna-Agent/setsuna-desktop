import { setImmediate } from 'node:timers/promises';

/** Stop between complete down/up gestures, never halfway through a held key. */
export class InputAdmission {
  private closed = false;
  close(): void { this.closed = true; }
  check(): void { if (this.closed) throw new Error('Desktop input cancelled.'); }
  async each<T>(units: Iterable<T>, dispatch: (unit: T) => Promise<void>): Promise<void> {
    for (const unit of units) {
      this.check();
      await dispatch(unit);
      // Give the parent's stop message a chance to revoke the next character/scroll.
      await setImmediate();
    }
    this.check();
  }
}
