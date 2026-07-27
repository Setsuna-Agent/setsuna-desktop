import { describe, expect, it } from 'vitest';
import { recordInput } from '../../src/shared/unknown.js';

describe('recordInput', () => {
  it('preserves non-null objects and rejects non-record boundary values', () => {
    const record = { enabled: true };

    expect(recordInput(record)).toBe(record);
    expect(recordInput(null)).toEqual({});
    expect(recordInput(['value'])).toEqual({});
    expect(recordInput('value')).toEqual({});
  });
});
