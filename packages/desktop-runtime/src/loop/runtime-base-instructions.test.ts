import { describe, expect, it } from 'vitest';
import { RUNTIME_BASE_INSTRUCTIONS } from './runtime-base-instructions.js';

describe('RUNTIME_BASE_INSTRUCTIONS', () => {
  it('requires repository workflow discovery before mutation or validation', () => {
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('determine the declared workflow before modifying or validating');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('Never guess the package manager');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('preserve their flags for narrower checks');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('validate narrow-to-broad');
  });
});
