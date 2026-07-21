import { describe, expect, it } from 'vitest';
import { BRAND_ICON_MAX_BYTES, defaultModelMaxOutputTokens, normalizeBrandIconConfig } from './config.js';

describe('normalizeBrandIconConfig', () => {
  it('normalizes preset keys', () => {
    expect(normalizeBrandIconConfig({ type: 'preset', key: '  MiniMax  ' })).toEqual({
      type: 'preset',
      key: 'minimax',
    });
  });

  it('accepts supported inline image types', () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('provider icon').toString('base64')}`;
    expect(normalizeBrandIconConfig({ type: 'custom', dataUrl })).toEqual({ type: 'custom', dataUrl });
  });

  it('rejects SVG, malformed and oversized inline images', () => {
    expect(normalizeBrandIconConfig({ type: 'custom', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })).toBeUndefined();
    expect(normalizeBrandIconConfig({ type: 'custom', dataUrl: 'not-an-image' })).toBeUndefined();
    const oversized = Buffer.alloc(BRAND_ICON_MAX_BYTES + 1).toString('base64');
    expect(normalizeBrandIconConfig({ type: 'custom', dataUrl: `data:image/png;base64,${oversized}` })).toBeUndefined();
  });
});

describe('defaultModelMaxOutputTokens', () => {
  it('uses a conservative fallback for Anthropic models without discovered limits', () => {
    expect(defaultModelMaxOutputTokens('anthropic')).toBe(8192);
    expect(defaultModelMaxOutputTokens('openai-compatible')).toBe(68000);
    expect(defaultModelMaxOutputTokens('openai-responses')).toBe(68000);
  });
});
