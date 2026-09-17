import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { ModelDiagnostic, StoredThreadEvent } from '@setsuna-desktop/contracts';

const MAX_BYTES = 1024 * 1024;
const MAX_PENDING_WRITES = 256;
const LIFECYCLE_EVENTS = new Set([
  'turn.started', 'turn.step_snapshot', 'tool.started', 'tool.completed',
  'item.started', 'turn.completed', 'turn.cancelled', 'runtime.error',
]);

/** One bounded JSONL file; asynchronous writes never hold up sampling or event publication. */
export class ModelLatencyLog {
  readonly filePath: string;
  private queue = Promise.resolve();
  private pending = 0;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'logs', 'model-latency.jsonl');
  }

  record(record: ModelDiagnostic): void {
    if (this.pending >= MAX_PENDING_WRITES) return;
    const line = Buffer.from(`${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...record })}\n`);
    if (line.byteLength > 4096) return;
    this.pending += 1;
    this.queue = this.queue.then(() => this.append(line)).catch(() => {
      // Read-only/full disks must not fail the user's turn or create an unhandled rejection.
    }).finally(() => { this.pending -= 1; });
  }

  recordEvent(event: StoredThreadEvent): void {
    if (!LIFECYCLE_EVENTS.has(event.type)) return;
    this.record({
      phase: event.type,
      threadId: event.threadId,
      turnId: event.turnId,
      eventSeq: event.seq,
      eventAt: event.createdAt,
    });
  }

  flush(): Promise<void> { return this.queue; }

  private async append(line: Buffer): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const file = await open(this.filePath, 'a+', 0o600);
    try {
      const { size } = await file.stat();
      if (size + line.byteLength > MAX_BYTES) {
        // Retain the newest half on overflow, starting at a complete UTF-8 JSON line.
        // No backup file: total retained log storage remains at most one MiB.
        const tail = Buffer.alloc(Math.min(size, MAX_BYTES / 2));
        const { bytesRead } = await file.read(tail, 0, tail.length, size - tail.length);
        const boundary = tail.indexOf(10);
        await file.truncate(0);
        if (boundary >= 0) await file.writeFile(tail.subarray(boundary + 1, bytesRead));
      }
      await file.writeFile(line);
    } finally {
      await file.close();
    }
  }
}
