import { describe, expect, it } from 'vitest';
import { electronMainExternals, runtimeExternals } from '../build-electron.js';

describe('electron build externals', () => {
  it('keeps node-pty external for every process that loads it', () => {
    expect(electronMainExternals).toContain('node-pty');
    expect(runtimeExternals).toContain('node-pty');
  });
});
