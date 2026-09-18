import type { Terminal } from '@xterm/xterm';
import {
  appendTerminalRestoreBuffer,
  initializeTerminalRestoreBuffer,
  retainTerminalPendingEntries,
  type TerminalGrid,
  type TerminalRestoreBuffer,
  type TerminalRestoreEntry,
} from './terminalRestoreBuffer.js';

type OutputOperation =
  | { entry: TerminalRestoreEntry; record: boolean }
  | { after: () => void };

/** Keep asynchronous writes and synchronous resizes in one replayable order. */
export function createTerminalOutput(
  terminal: Pick<Terminal, 'cols' | 'rows' | 'write' | 'resize' | 'onResize'>,
  sessionId: string,
  restored?: TerminalRestoreBuffer,
) {
  initializeTerminalRestoreBuffer(sessionId, { cols: terminal.cols, rows: terminal.rows });
  const queue: OutputOperation[] = (restored?.entries ?? []).map((entry) => ({ entry, record: false }));
  let disposed = false;
  let writing = false;
  let pendingWrite: TerminalRestoreEntry | null = null;
  let replaying = queue.length > 0;
  queue.push({ after: () => { replaying = false; } });
  // Only parsed history suppresses protocol replies. Resume the unparsed tail
  // after that boundary and transfer ownership from the cache to this queue.
  for (const entry of restored?.pendingEntries ?? []) queue.push({ entry, record: true });
  retainTerminalPendingEntries(sessionId, []);
  const resizeDisposable = terminal.onResize(({ cols, rows }) => {
    if (!disposed && !replaying) appendTerminalRestoreBuffer(sessionId, { type: 'resize', cols, rows });
  });

  function drain(): void {
    if (disposed || writing) return;
    writing = true;
    while (!disposed && queue.length > 0) {
      const operation = queue.shift()!;
      if ('entry' in operation) {
        if (operation.entry.type === 'output') {
          pendingWrite = operation.record ? operation.entry : null;
          terminal.write(operation.entry.text, () => {
            if (disposed) return;
            // write() queues parsing; only its callback makes this safe to replay
            // as history without sending a duplicate reply to the PTY.
            if (operation.record) appendTerminalRestoreBuffer(sessionId, operation.entry);
            pendingWrite = null;
            writing = false;
            drain();
          });
          return;
        }
        terminal.resize(operation.entry.cols, operation.entry.rows);
      }
      if ('after' in operation) operation.after();
    }
    writing = false;
  }

  function enqueue(operation: OutputOperation): void {
    if (disposed) return;
    queue.push(operation);
    drain();
  }

  drain();
  return {
    get replaying() { return replaying; },
    write(text: string): void {
      if (text) enqueue({ entry: { type: 'output', text }, record: true });
    },
    resize(grid: TerminalGrid): void {
      if (!Number.isInteger(grid.cols) || !Number.isInteger(grid.rows) || grid.cols < 1 || grid.rows < 1) return;
      enqueue({ entry: { type: 'resize', cols: grid.cols, rows: grid.rows }, record: true });
    },
    afterPendingOutput(after: () => void): void {
      enqueue({ after });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      resizeDisposable.dispose();
      // Keep the in-flight write as well as queued PTY events. Parsed history
      // stays in the cache; pending layout callbacks never took effect.
      const pendingEntries = pendingWrite ? [pendingWrite] : [];
      for (const operation of queue) {
        if ('entry' in operation && operation.record) {
          pendingEntries.push(operation.entry);
        }
      }
      retainTerminalPendingEntries(sessionId, pendingEntries);
      pendingWrite = null;
      queue.length = 0;
    },
  };
}

export type TerminalOutput = ReturnType<typeof createTerminalOutput>;
