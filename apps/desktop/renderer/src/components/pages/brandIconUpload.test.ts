import { describe, expect, it } from 'vitest';
import { BRAND_ICON_MAX_BYTES } from '@setsuna-desktop/contracts';
import { brandIconFileError } from './brandIconUpload.js';

describe('brandIconFileError', () => {
  it('accepts supported image files within the size limit', () => {
    expect(brandIconFileError({ name: 'logo.webp', type: 'image/webp', size: 2048 })).toBeNull();
  });

  it('rejects unsupported, empty and oversized files', () => {
    expect(brandIconFileError({ name: 'logo.svg', type: 'image/svg+xml', size: 1024 })).toContain('PNG');
    expect(brandIconFileError({ name: 'empty.png', type: 'image/png', size: 0 })).toContain('为空');
    expect(brandIconFileError({
      name: 'huge.png',
      type: 'image/png',
      size: BRAND_ICON_MAX_BYTES + 1,
    })).toContain('512 KB');
  });
});
