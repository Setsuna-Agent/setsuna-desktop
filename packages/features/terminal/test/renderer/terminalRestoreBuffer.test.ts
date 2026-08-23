import { afterEach, describe, expect, it } from 'vitest';
import {
  appendTerminalRestoreBuffer,
  clearTerminalRestoreBuffer,
  markTerminalSessionExited,
  recordTerminalEventSeq,
  terminalLastEventSeq,
  terminalRestoreBuffer,
  terminalSessionExited,
} from '../../src/renderer/terminalRestoreBuffer.js';

const sessionId = 'terminal_test';

afterEach(() => clearTerminalRestoreBuffer(sessionId));

describe('terminal restore buffer', () => {
  it('keeps terminal replay state outside the xterm UI module', () => {
    appendTerminalRestoreBuffer(sessionId, 'first');
    appendTerminalRestoreBuffer(sessionId, ' second');
    recordTerminalEventSeq(sessionId, 4);
    markTerminalSessionExited(sessionId, true);

    expect(terminalRestoreBuffer(sessionId)).toBe('first second');
    expect(terminalLastEventSeq(sessionId)).toBe(4);
    expect(terminalSessionExited(sessionId)).toBe(true);

    clearTerminalRestoreBuffer(sessionId);
    expect(terminalRestoreBuffer(sessionId)).toBeUndefined();
    expect(terminalLastEventSeq(sessionId)).toBe(0);
    expect(terminalSessionExited(sessionId)).toBe(false);
  });

  it('bounds replay text retained for a long-running session', () => {
    appendTerminalRestoreBuffer(sessionId, `prefix${'x'.repeat(1_000_000)}`);

    const restored = terminalRestoreBuffer(sessionId);
    expect(restored).toHaveLength(1_000_000);
    expect(restored?.startsWith('x')).toBe(true);
  });
});
