import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendTerminalRestoreBuffer,
  clearTerminalRestoreBuffer,
  initializeTerminalRestoreBuffer,
  markTerminalSessionExited,
  recordTerminalEventSeq,
  terminalLastEventSeq,
  terminalRestoreBuffer,
  terminalSessionExited,
} from '../../src/renderer/terminalRestoreBuffer.js';

const sessionId = 'terminal_test';

beforeEach(() => initializeTerminalRestoreBuffer(sessionId, { cols: 100, rows: 24 }));
afterEach(() => clearTerminalRestoreBuffer(sessionId));

describe('terminal restore buffer', () => {
  it('keeps terminal replay state outside the xterm UI module', () => {
    appendTerminalRestoreBuffer(sessionId, { type: 'output', text: 'first' });
    appendTerminalRestoreBuffer(sessionId, { type: 'output', text: ' second' });
    recordTerminalEventSeq(sessionId, 4);
    markTerminalSessionExited(sessionId, true);

    expect(terminalRestoreBuffer(sessionId)).toEqual({
      initialGrid: { cols: 100, rows: 24 },
      entries: [{ type: 'output', text: 'first second' }],
      pendingEntries: [],
    });
    expect(terminalLastEventSeq(sessionId)).toBe(4);
    expect(terminalSessionExited(sessionId)).toBe(true);

    clearTerminalRestoreBuffer(sessionId);
    expect(terminalRestoreBuffer(sessionId)).toBeUndefined();
    expect(terminalLastEventSeq(sessionId)).toBe(0);
    expect(terminalSessionExited(sessionId)).toBe(false);
  });

  it('bounds replay text while retaining the grid at the truncation boundary', () => {
    appendTerminalRestoreBuffer(sessionId, { type: 'output', text: 'prefix' });
    appendTerminalRestoreBuffer(sessionId, { type: 'resize', cols: 80, rows: 6 });
    appendTerminalRestoreBuffer(sessionId, { type: 'output', text: 'x'.repeat(1_000_000) });

    const restored = terminalRestoreBuffer(sessionId);
    expect(restored?.initialGrid).toEqual({ cols: 80, rows: 6 });
    expect(restored?.entries).toEqual([{ type: 'output', text: 'x'.repeat(1_000_000) }]);
  });
});
