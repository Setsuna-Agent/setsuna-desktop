import { describe, expect, it } from 'vitest';
import { terminalDisplayTitle } from '../../src/renderer/terminalTitle.js';

describe('terminalDisplayTitle', () => {

  it('caps untrusted terminal titles before storing them in the panel state', () => {
    expect(terminalDisplayTitle('a'.repeat(200), 'zsh')).toHaveLength(160);
  });
});
