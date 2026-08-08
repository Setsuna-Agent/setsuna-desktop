import { describe, expect, it } from 'vitest';
import { enqueueToast, type ToastEntry } from '../../../../src/app/providers/ToastProvider.js';

describe('ToastProvider', () => {
  it('deduplicates repeated feedback and keeps the newest four notifications', () => {
    const entries = [1, 2, 3, 4, 5].reduce<ToastEntry[]>((current, id) => enqueueToast(current, {
      durationMs: 3_500,
      id,
      message: `message-${id}`,
      tone: 'success',
    }), []);

    expect(entries.map((toast) => toast.id)).toEqual([2, 3, 4, 5]);
    expect(enqueueToast(entries, {
      durationMs: 3_500,
      id: 6,
      message: 'message-5',
      tone: 'success',
    }).map((toast) => toast.id)).toEqual([2, 3, 4, 6]);
  });
});
