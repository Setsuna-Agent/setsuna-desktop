import { BRAND_ICON_MAX_BYTES } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { parsePluginAppAppearance } from '../../../../../src/kernel/declarative-plugin-ui/app-appearance/preferences.js';

describe('Plugin app appearance storage boundary', () => {
  it('recovers corrupt preferences and rejects external, active, unknown and oversized avatars independently of the name', () => {
    for (const raw of ['{', 'null', '[]', '42']) expect(parsePluginAppAppearance(raw)).toEqual({});
    for (const avatar of [
      { type: 'custom', dataUrl: 'https://example.com/avatar.png' },
      { type: 'custom', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
      { type: 'custom', dataUrl: `data:image/png;base64,${'AAAA'.repeat(Math.ceil(BRAND_ICON_MAX_BYTES / 3) + 1)}` },
      { type: 'preset', key: 'unknown-preset' },
    ]) {
      expect(parsePluginAppAppearance(JSON.stringify({ name: '  我的应用  ', avatar }))).toEqual({ name: '我的应用' });
    }
  });

  it('accepts palette preferences and discards invalid colors without losing the app identity', () => {
    const appearance = { name: '我的应用', avatar: { type: 'preset', key: 'table' } };
    for (const avatarColor of ['#12b84c', 'text']) {
      expect(parsePluginAppAppearance(JSON.stringify({ ...appearance, avatarColor })))
        .toEqual({ ...appearance, avatarColor });
    }
    expect(parsePluginAppAppearance(JSON.stringify({ ...appearance, avatarColor: '#31a183' })))
      .toEqual({ ...appearance, avatarColor: '#12b84c' });
    for (const avatarColor of ['red', 'url(https://example.com/image)', '#123456', 1, null]) {
      expect(parsePluginAppAppearance(JSON.stringify({ ...appearance, avatarColor }))).toEqual(appearance);
    }
  });
});
