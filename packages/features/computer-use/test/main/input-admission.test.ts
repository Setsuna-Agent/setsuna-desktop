import { describe, expect, it } from 'vitest';
import { InputAdmission } from '../../src/main/input-admission.js';

describe('cooperative native input cancellation', () => {
  it('allows the admitted key-up, then rejects the remaining characters', async () => {
    const admission = new InputAdmission(); const events: string[] = [];
    const run = admission.each('abc', async (character) => {
      events.push(`${character}:down`);
      admission.close();
      await Promise.resolve();
      events.push(`${character}:up`);
    });
    await expect(run).rejects.toThrow('cancelled');
    expect(events).toEqual(['a:down', 'a:up']);
    await expect(admission.each('d', async () => { events.push('unexpected'); })).rejects.toThrow('cancelled');
    expect(events).toHaveLength(2);
  });
  it('preserves Unicode codepoints and stops after an input failure', async () => {
    const admission = new InputAdmission(); const seen: string[] = [];
    await admission.each('a你😀', async (unit) => { seen.push(unit); });
    expect(seen).toEqual(['a', '你', '😀']);
    await expect(admission.each('ab', async (unit) => { seen.push(unit); throw new Error('native failed'); })).rejects.toThrow('native failed');
    expect(seen.at(-1)).toBe('a');
  });
});
