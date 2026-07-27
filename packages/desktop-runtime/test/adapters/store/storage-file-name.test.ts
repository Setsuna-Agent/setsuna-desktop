import { describe, expect, it } from 'vitest';
import {
  replaceControlCharacters,
  safeStorageFileStem,
} from '../../../src/adapters/store/storage-file-name.js';

describe('runtime storage file names', () => {
  it('replaces control characters without changing visible Unicode text', () => {
    expect(replaceControlCharacters('报表\u0000草稿', '_')).toBe('报表_草稿');
  });

  it('normalizes invalid and Windows-reserved file stems', () => {
    expect(safeStorageFileStem('mountain:night', 'image')).toBe('mountain_night');
    expect(safeStorageFileStem('CON', 'file')).toBe('_CON');
    expect(safeStorageFileStem(' ... ', 'file')).toBe('file');
  });
});
