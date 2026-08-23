import type { RuntimeUsageResponse } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  fulfilledUsageValue,
  isOwnedRequestCurrent,
} from '../../../../src/services/runtime-client/useRuntimeUsageState.js';

describe('fulfilledUsageValue', () => {
  it('hydrates optional usage only when bootstrap succeeded', () => {
    const usage = { total: { inputTokens: 12 } } as unknown as RuntimeUsageResponse;

    expect(fulfilledUsageValue({ status: 'fulfilled', value: usage })).toBe(usage);
    expect(fulfilledUsageValue({
      status: 'rejected',
      reason: new Error('usage unavailable'),
    })).toBeUndefined();
  });
});

describe('isOwnedRequestCurrent', () => {
  it('requires both the latest request and the same thread owner', () => {
    expect(isOwnedRequestCurrent('thread_1', 'thread_1', true)).toBe(true);
    expect(isOwnedRequestCurrent('thread_1', 'thread_2', true)).toBe(false);
    expect(isOwnedRequestCurrent('thread_1', 'thread_1', false)).toBe(false);
    expect(isOwnedRequestCurrent('thread_1', null, true)).toBe(false);
  });
});
