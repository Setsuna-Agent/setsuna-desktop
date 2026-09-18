import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { createTerminalOutput } from '../../src/renderer/terminalOutput.js';
import { clearTerminalRestoreBuffer, terminalRestoreBuffer } from '../../src/renderer/terminalRestoreBuffer.js';

const sessionId = 'terminal-pending-output';
const terminals: Terminal[] = [];

afterEach(() => {
  terminals.splice(0).forEach((terminal) => terminal.dispose());
  clearTerminalRestoreBuffer(sessionId);
});

describe('terminal output ordering', () => {
  it.each(['layout', 'ready'] as const)('retains pending output on unmount with a queued %s resize', async (source) => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i}\r\n`).join('');
    const clear = '\u001b[2J\u001b[Hprompt> ';
    const expected = createTerminal(80, 6);
    await new Promise<void>((resolve) => expected.write(text, resolve));
    if (source === 'ready') expected.resize(80, 4);
    await new Promise<void>((resolve) => expected.write(clear, resolve));
    expect(bufferText(expected).slice(0, 5)).toEqual(['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);

    const original = createTerminal(100, 24);
    const output = createTerminalOutput(original, sessionId);
    output.afterPendingOutput(() => original.resize(80, 6));
    output.write(text);
    // A future fit never happened, but a ready event describes a grid the PTY
    // already uses. Unmount must distinguish these while retaining both chunks.
    if (source === 'layout') output.afterPendingOutput(() => original.resize(80, 4));
    else output.resize({ cols: 80, rows: 4 });
    output.write(clear);
    output.dispose();
    original.dispose();

    const saved = terminalRestoreBuffer(sessionId)!;
    const restored = createTerminal(saved.initialGrid.cols, saved.initialGrid.rows);
    const replay = createTerminalOutput(restored, sessionId, saved);
    try {
      await new Promise<void>((resolve) => replay.afterPendingOutput(resolve));
      expect(restored.rows).toBe(expected.rows);
      expect(bufferText(restored)).toEqual(bufferText(expected));
    } finally {
      replay.dispose();
    }
  });
});

function createTerminal(cols: number, rows: number): Terminal {
  const terminal = new Terminal({ cols, rows, allowProposedApi: true });
  terminals.push(terminal);
  return terminal;
}

function bufferText(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  return Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '');
}
