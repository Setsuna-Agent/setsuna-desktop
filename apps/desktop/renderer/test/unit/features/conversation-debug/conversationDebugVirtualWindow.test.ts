import { describe, expect, it } from 'vitest';
import { calculateFixedVirtualWindow } from '../../../../src/features/conversation-debug/useConversationDebugVirtualWindow.js';

describe('conversation debug virtual window', () => {
  it('mounts only viewport rows plus bounded overscan for a large history', () => {
    const result = calculateFixedVirtualWindow({
      itemCount: 10_000,
      itemSize: 50,
      overscan: 5,
      scrollOffset: 5_000,
      viewportSize: 500,
    });

    expect(result).toEqual({
      startIndex: 95,
      endIndex: 115,
      totalSize: 500_000,
    });
    expect(result.endIndex - result.startIndex).toBe(20);
  });

  it('accounts for fixed headers and clamps the tail window', () => {
    expect(calculateFixedVirtualWindow({
      itemCount: 100,
      itemSize: 108,
      overscan: 2,
      paddingEnd: 44,
      paddingStart: 72,
      scrollOffset: 0,
      viewportSize: 300,
    })).toEqual({
      startIndex: 0,
      endIndex: 5,
      totalSize: 10_916,
    });

    const tail = calculateFixedVirtualWindow({
      itemCount: 100,
      itemSize: 50,
      overscan: 4,
      scrollOffset: 4_900,
      viewportSize: 400,
    });
    expect(tail.startIndex).toBe(94);
    expect(tail.endIndex).toBe(100);
  });
});
