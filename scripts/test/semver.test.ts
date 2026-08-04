import { describe, expect, it } from 'vitest';
import { isValidSemver } from '../semver.mjs';

describe('isValidSemver', () => {
  it.each([
    '0.0.0',
    '1.2.3',
    '1.2.3-alpha',
    '1.2.3-alpha.1',
    '1.2.3-0A-0.1+build.001',
    '1.2.3+001',
  ])('accepts %s', (version) => {
    expect(isValidSemver(version)).toBe(true);
  });

  it.each([
    '',
    '1.2',
    '1.2.3.4',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-',
    '1.2.3-alpha..1',
    '1.2.3-01',
    '1.2.3+build+again',
    '1.2.3+bad_value',
  ])('rejects %s', (version) => {
    expect(isValidSemver(version)).toBe(false);
  });

  it('rejects adversarial invalid input in linear time', () => {
    expect(isValidSemver(`0.0.0-0.${'--.'.repeat(100_000)}`)).toBe(false);
  });
});
