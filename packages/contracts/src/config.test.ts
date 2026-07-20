import { describe, expect, it } from 'vitest';
import { normalizeProviderIconConfig, PROVIDER_CUSTOM_ICON_MAX_BYTES } from './config.js';

describe('normalizeProviderIconConfig', () => {
  it('normalizes preset keys', () => {
    expect(normalizeProviderIconConfig({ type: 'preset', key: '  MiniMax  ' })).toEqual({
      type: 'preset',
      key: 'minimax',
    });
  });

  it('accepts supported inline image types', () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('provider icon').toString('base64')}`;
    expect(normalizeProviderIconConfig({ type: 'custom', dataUrl })).toEqual({ type: 'custom', dataUrl });
  });

  it('rejects SVG, malformed and oversized inline images', () => {
    expect(normalizeProviderIconConfig({ type: 'custom', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })).toBeUndefined();
    expect(normalizeProviderIconConfig({ type: 'custom', dataUrl: 'not-an-image' })).toBeUndefined();
    const oversized = Buffer.alloc(PROVIDER_CUSTOM_ICON_MAX_BYTES + 1).toString('base64');
    expect(normalizeProviderIconConfig({ type: 'custom', dataUrl: `data:image/png;base64,${oversized}` })).toBeUndefined();
  });
});
