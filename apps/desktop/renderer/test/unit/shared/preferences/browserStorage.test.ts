import { describe, expect, it, vi } from 'vitest';
import {
  readStorageValue,
  removeStorageValue,
  writeStorageValue,
} from '../../../../src/shared/preferences/browserStorage.js';

describe('browser storage boundary', () => {
  it('returns stored values and reports successful writes and removals', () => {
    const storage = {
      getItem: vi.fn(() => 'saved'),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };

    expect(readStorageValue(storage, 'preference')).toBe('saved');
    expect(writeStorageValue(storage, 'preference', 'next')).toBe(true);
    expect(removeStorageValue(storage, 'preference')).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith('preference', 'next');
    expect(storage.removeItem).toHaveBeenCalledWith('preference');
  });

  it('turns unavailable or throwing storage into an explicit fallback result', () => {
    const unavailable = {
      getItem: vi.fn(() => { throw new Error('denied'); }),
      removeItem: vi.fn(() => { throw new Error('denied'); }),
      setItem: vi.fn(() => { throw new Error('denied'); }),
    };

    expect(readStorageValue(null, 'preference')).toBeNull();
    expect(readStorageValue(unavailable, 'preference')).toBeNull();
    expect(writeStorageValue(unavailable, 'preference', 'next')).toBe(false);
    expect(removeStorageValue(unavailable, 'preference')).toBe(false);
  });
});
