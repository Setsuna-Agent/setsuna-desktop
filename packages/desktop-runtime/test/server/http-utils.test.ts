import { describe, expect, it } from 'vitest';
import { isRuntimeMessageAttachment } from '../../src/server/http-utils.js';

describe('runtime HTTP attachment validation', () => {
  it('accepts input attachment sources and rejects generated output assets', () => {
    const base = { id: 'attachment_1', name: 'image.png', type: 'image/png', size: 42 };

    expect(isRuntimeMessageAttachment({ ...base, url: 'data:image/png;base64,AA==' })).toBe(true);
    expect(isRuntimeMessageAttachment({ ...base, source: 'inline', url: 'data:image/png;base64,AA==' })).toBe(true);
    expect(isRuntimeMessageAttachment({ ...base, source: 'runtime', assetId: 'attachment_asset_1' })).toBe(true);
    expect(isRuntimeMessageAttachment({
      ...base,
      source: 'generated',
      assetId: 'generated_image_1',
      url: 'data:image/png;base64,AA==',
    })).toBe(false);
  });
});
