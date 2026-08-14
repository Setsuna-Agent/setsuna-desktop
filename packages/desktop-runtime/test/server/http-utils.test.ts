import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { isRuntimeMessageAttachment, readBinaryBody } from '../../src/server/http-utils.js';

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

  it('bounds streamed binary request bodies before concatenating them', async () => {
    const request = Object.assign(Readable.from([Buffer.from('123'), Buffer.from('45')]), {
      headers: {},
    }) as IncomingMessage;

    await expect(readBinaryBody(request, 4)).rejects.toMatchObject({
      code: 'body_too_large',
      statusCode: 413,
    });
  });
});
