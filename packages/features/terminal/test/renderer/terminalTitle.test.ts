import { describe, expect, it } from 'vitest';
import { terminalDisplayTitle } from '../../src/renderer/terminalTitle.js';

describe('terminalDisplayTitle', () => {
  it('uses the session shell until the terminal publishes a title', () => {
    expect(terminalDisplayTitle('', 'zsh')).toBe('zsh');
  });

  it('normalizes a title published by the terminal', () => {
    expect(terminalDisplayTitle('\u0000 setsuna-desktop\n— zsh ', 'zsh')).toBe('setsuna-desktop — zsh');
  });

  it('caps untrusted terminal titles before storing them in the panel state', () => {
    expect(terminalDisplayTitle('a'.repeat(200), 'zsh')).toHaveLength(160);
  });
});
