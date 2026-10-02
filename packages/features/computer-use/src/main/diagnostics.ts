import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
export type ComputerDiagnostic = {
  event: 'command' | 'supervisor-ready' | 'capture-before' | 'capture-after' | 'stopped' | 'rejected' | 'transport';
  reason?: string; command?: string; phase?: string; run?: number; active?: boolean;
  ownerMatches?: boolean; sessionMatches?: boolean; signalAborted?: boolean;
  elapsedMs?: number; width?: number; height?: number; displayId?: number;
};

/** Bounded metadata journal. No image, title, URL, input, credential or task identity. */
export class ComputerDiagnosticJournal {
  private pending: Promise<void> = Promise.resolve();
  private sequence = 0;
  private warned = false;
  constructor(private readonly file: string, private readonly maximumBytes = 2_000_000) {}
  record(event: ComputerDiagnostic): void {
    // Explicit projection also prevents accidental runtime additions from leaking.
    const { event: name, reason, command, phase, run, active, ownerMatches, sessionMatches, signalAborted, elapsedMs, width, height, displayId } = event;
    const line = JSON.stringify({ version: 4, sequence: ++this.sequence, at: new Date().toISOString(), pid: process.pid, event: name, reason, command, phase, run, active, ownerMatches, sessionMatches, signalAborted, elapsedMs, width, height, displayId }) + '\n';
    this.pending = this.pending.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const size = await stat(this.file).then((value) => value.size, () => 0);
      if (size && size + Buffer.byteLength(line) > this.maximumBytes) await rename(this.file, `${this.file}.1`);
      await appendFile(this.file, line, { mode: 0o600 });
    }).catch(() => {
      if (!this.warned) console.warn('[computer-use] diagnostic persistence unavailable');
      this.warned = true;
    });
  }
  async flush(): Promise<void> { await this.pending; }
}
