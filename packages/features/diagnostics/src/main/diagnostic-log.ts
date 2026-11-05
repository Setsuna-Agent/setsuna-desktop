import type { DiagnosticFields } from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export const DIAGNOSTIC_LOG_MAX_BYTES = 2 * 1024 * 1024;
const MAX_QUEUED_ENTRIES = 256;
const BACKUP_COUNT = 3;

type DiagnosticContext = {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  v8Version: string;
  platform: string;
  arch: string;
  osVersion: string;
};

/** Main owns this log so a lost renderer cannot take its crash diagnostics with it. */
export class DesktopDiagnosticLog {
  private pending = Promise.resolve();
  private queuedEntries = 0;
  private readonly sessionId = randomUUID();

  constructor(readonly directory: string, private readonly context: DiagnosticContext) {}

  record(event: string, details: DiagnosticFields): void {
    // A stalled disk must not grow an unbounded queue or delay application readiness.
    if (this.queuedEntries >= MAX_QUEUED_ENTRIES) return;
    const line = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      ...this.context,
      sessionId: this.sessionId,
      mainProcessId: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      event,
      details,
    })}\n`;
    this.queuedEntries += 1;
    this.pending = this.pending.then(() => this.append(line)).catch((error: unknown) => {
      console.error('[desktop-diagnostics] failed to write log', error);
    }).finally(() => { this.queuedEntries -= 1; });
  }

  async flush(timeoutMs?: number): Promise<void> {
    if (timeoutMs === undefined) return this.pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.pending,
        new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  private filePath(backup = 0): string {
    return path.join(this.directory, `desktop-diagnostics${backup ? `.${backup}` : ''}.jsonl`);
  }

  private async append(line: string): Promise<void> {
    // No filesystem work runs until an event is recorded; registration stays synchronous.
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const size = await stat(this.filePath()).then((file) => file.size).catch((error: unknown) => {
      if (isMissingFile(error)) return 0;
      throw error;
    });
    if (size && size + Buffer.byteLength(line) > DIAGNOSTIC_LOG_MAX_BYTES) {
      await rm(this.filePath(BACKUP_COUNT), { force: true });
      for (let backup = BACKUP_COUNT - 1; backup >= 0; backup -= 1) {
        await rename(this.filePath(backup), this.filePath(backup + 1)).catch((error: unknown) => {
          if (!isMissingFile(error)) throw error;
        });
      }
    }
    await appendFile(this.filePath(), line, { encoding: 'utf8', mode: 0o600 });
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
