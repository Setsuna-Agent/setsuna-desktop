import { describe, expect, it } from 'vitest';
import {
  buildThreadSearchPreview,
  normalizedThreadSearch,
} from '../../../src/adapters/store/thread-search.js';

describe('thread search normalization', () => {
  it('uses compact whitespace and Unicode-aware lowercase matching', () => {
    expect(normalizedThreadSearch('  НАЧАЛО\nCAFÉ  ')).toBe('начало café');
    expect(buildThreadSearchPreview(
      'Earlier context НАЧАЛО\nCAFÉ later context',
      'начало café',
    )).toContain('НАЧАЛО CAFÉ');
  });
});
