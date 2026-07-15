import { describe, expect, it } from 'vitest';
import { createLatestRequestGuard } from './useLatestRequestGuard.js';

describe('createLatestRequestGuard', () => {
  it('accepts only the newest request until it is invalidated', () => {
    const guard = createLatestRequestGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(first()).toBe(false);
    expect(second()).toBe(true);

    guard.invalidate();
    expect(second()).toBe(false);
  });
});
