import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ModelClient } from '../../ports/model-client.js';
import { ImageAssetResolvingModelClient } from './image-asset-resolving-model-client.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('image asset resolving model client', () => {
  it('hydrates visible managed images only in the provider request', async () => {
    const inner = new CapturingModelClient();
    const read = vi.fn(async () => ({ name: 'page.png', type: 'image/png', data: ONE_PIXEL_PNG }));
    const client = new ImageAssetResolvingModelClient(inner, { read });
    const request: ModelRequest = {
      model: 'vision-model',
      messages: [{
        id: 'tool_message',
        role: 'tool',
        toolCallId: 'call_view_image',
        toolName: 'view_image',
        content: 'Loaded page.png.',
        attachments: [
          {
            id: 'visible_image',
            assetId: 'asset_visible',
            source: 'generated',
            name: 'page.png',
            type: 'image/png',
            size: ONE_PIXEL_PNG.byteLength,
            modelVisible: true,
          },
          {
            id: 'display_only_image',
            assetId: 'asset_display_only',
            source: 'generated',
            name: 'generated.png',
            type: 'image/png',
            size: ONE_PIXEL_PNG.byteLength,
            modelVisible: false,
          },
        ],
        createdAt: '2026-07-18T00:00:00.000Z',
        status: 'complete',
      }],
    };

    for await (const _event of client.stream(request)) {
      // Drain the request so the async generator reaches the wrapped client.
    }

    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith('asset_visible');
    expect(inner.request?.messages[0]?.attachments).toEqual([
      expect.objectContaining({
        id: 'visible_image',
        url: `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`,
      }),
      expect.objectContaining({
        id: 'display_only_image',
        assetId: 'asset_display_only',
        modelVisible: false,
      }),
    ]);
    expect(request.messages[0]?.attachments?.[0]).toEqual(expect.objectContaining({
      assetId: 'asset_visible',
      source: 'generated',
    }));
    expect(JSON.stringify(request)).not.toContain(ONE_PIXEL_PNG.toString('base64'));
  });
});

class CapturingModelClient implements ModelClient {
  request?: ModelRequest;

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.request = request;
    yield { type: 'text_delta', text: 'ok' };
  }
}
