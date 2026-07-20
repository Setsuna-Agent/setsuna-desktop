import { describe, expect, it } from 'vitest';
import { PROVIDER_CUSTOM_ICON_MAX_BYTES } from '@setsuna-desktop/contracts';
import { providerIconFileError } from './providerIconUpload.js';

describe('providerIconFileError', () => {
  it('accepts supported image files within the size limit', () => {
    expect(providerIconFileError({ name: 'logo.webp', type: 'image/webp', size: 2048 })).toBeNull();
  });

  it('rejects unsupported, empty and oversized files', () => {
    expect(providerIconFileError({ name: 'logo.svg', type: 'image/svg+xml', size: 1024 })).toContain('PNG');
    expect(providerIconFileError({ name: 'empty.png', type: 'image/png', size: 0 })).toContain('为空');
    expect(providerIconFileError({
      name: 'huge.png',
      type: 'image/png',
      size: PROVIDER_CUSTOM_ICON_MAX_BYTES + 1,
    })).toContain('512 KB');
  });
});
