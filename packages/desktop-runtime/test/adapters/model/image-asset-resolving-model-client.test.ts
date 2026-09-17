import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { ImageAssetResolvingModelClient } from '../../../src/adapters/model/image-asset-resolving-model-client.js';
import type { ModelClient } from '../../../src/ports/model-client.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const IMAGE_INPUT_FALLBACK_NOTICE = '图片视觉检查未能完成：模型供应商拒绝了图片输入。本轮将跳过视觉检查，并基于其余文本和工具结果继续。\n\n';

describe('image asset resolving model client', () => {
  it('applies saved compression changes to the next request including managed tool images', async () => {
    const data = await largePng();
    const inner = new CapturingModelClient();
    const getImageCompression = vi.fn<() => Promise<'high' | 'original'>>()
      .mockResolvedValueOnce('high').mockResolvedValueOnce('original').mockResolvedValueOnce('high');
    const client = new ImageAssetResolvingModelClient(inner, {
      read: async () => ({ name: 'screen.png', type: 'image/png', data }),
    }, { getImageCompression });
    const request = imageRequest(data);
    request.messages.push({
      ...request.messages[0]!, id: 'tool-result', role: 'tool', toolCallId: 'view', toolName: 'view_image',
      attachments: [{ id: 'managed-image', source: 'generated', assetId: 'screen', name: 'screen.png',
        type: 'image/png', size: data.length, modelVisible: true }],
    });
    const before = structuredClone(request);
    for (const type of ['image/webp', 'image/png', 'image/webp']) {
      for await (const _event of client.stream(request)) { /* Consume. */ }
      for (const message of inner.request!.messages) {
        expect(message.attachments?.[0]?.type).toBe(type);
        if (type === 'image/png') {
          expect(message.attachments?.[0]).toMatchObject({ url: `data:image/png;base64,${data.toString('base64')}` });
        }
      }
    }
    expect(getImageCompression).toHaveBeenCalledTimes(3);
    expect(request).toEqual(before);
  });

  it('optimizes user and tool PNGs on the wire while preserving the full request history', async () => {
    const data = await largePng();
    const inner = new CapturingModelClient();
    const read = vi.fn(async () => ({ name: 'screen.png', type: 'image/png', data }));
    const client = new ImageAssetResolvingModelClient(inner, { read });
    const request = imageRequest(data);
    request.messages.push({
      ...request.messages[0]!, id: 'tool-result', role: 'tool', toolCallId: 'view', toolName: 'view_image',
      content: 'Complete tool output', attachments: [{
        id: 'tool-image', source: 'generated', assetId: 'screen', name: 'screen.png',
        type: 'image/png', size: data.length, modelVisible: true,
      }],
    });
    const before = structuredClone(request);

    for await (const _event of client.stream(request)) { /* Consume. */ }

    expect(request).toEqual(before);
    expect(inner.request?.messages.map(({ content }) => content)).toEqual(request.messages.map(({ content }) => content));
    expect(inner.request?.messages).toHaveLength(2);
    for (const message of inner.request!.messages) {
      const attachment = message.attachments![0]!;
      expect(attachment.type).toBe('image/webp');
      expect(attachment.size).toBeLessThan(data.length);
    }
    expect(read).toHaveBeenCalledOnce();
  });

  it('retries an explicit WebP format rejection with original images and remembers that provider', async () => {
    const data = await largePng();
    const requests: ModelRequest[] = [];
    const inner: ModelClient = {
      async *stream(request) {
        requests.push(request);
        if (request.messages[0]?.attachments?.[0]?.type === 'image/webp') {
          throw new Error('Unsupported image format: image/webp');
        }
        yield { type: 'text_delta', text: 'ok' };
      },
    };
    const client = new ImageAssetResolvingModelClient(inner, { read: vi.fn() });
    const request = imageRequest(data);
    for (let turn = 0; turn < 2; turn += 1) {
      for await (const _event of client.stream(request)) { /* Consume. */ }
    }
    expect(requests.map((item) => item.messages[0]?.attachments?.[0]?.type)).toEqual(['image/webp', 'image/png', 'image/png']);
    expect(requests[1]?.messages).toEqual(request.messages);
    expect(requests[2]?.messages).toEqual(request.messages);
  });

  it('never retries an image-format error after the provider has emitted output', async () => {
    const stream = vi.fn(async function* () {
      yield { type: 'text_delta' as const, text: 'partial' };
      throw new Error('Unsupported image format: image/webp');
    });
    const client = new ImageAssetResolvingModelClient({ stream }, { read: vi.fn() });
    const iterator = client.stream(imageRequest(await largePng()));
    expect((await iterator.next()).value).toEqual({ type: 'text_delta', text: 'partial' });
    await expect(iterator.next()).rejects.toThrow('Unsupported image format');
    expect(stream).toHaveBeenCalledOnce();
  });

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

  it('retries a rejected image request and suppresses further images and notices in the same turn', async () => {
    const inner = new RejectFirstImageModelClient();
    const read = vi.fn(async () => ({ name: 'page.png', type: 'image/png', data: ONE_PIXEL_PNG }));
    const client = new ImageAssetResolvingModelClient(inner, { read });
    const request: ModelRequest = {
      model: 'vision-model',
      stepSnapshot: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        threadLastSeq: 1,
        conversationMessageIds: ['tool_message'],
        messageIds: ['tool_message'],
        toolNames: ['view_image'],
        selectedSkills: [],
        mcpServerKeys: [],
        mcpServerCount: 0,
        permissionProfile: 'workspace-write',
        featureKeys: [],
        worldState: { threadMessageCount: 1, threadUpdatedAt: '2026-07-18T00:00:00.000Z' },
      },
      messages: [{
        id: 'tool_message',
        turnId: 'turn_1',
        role: 'tool',
        toolCallId: 'call_view_image',
        toolName: 'view_image',
        content: 'Loaded page.png.',
        attachments: [{
          id: 'visible_image',
          assetId: 'asset_visible',
          source: 'generated',
          name: 'page.png',
          type: 'image/png',
          size: ONE_PIXEL_PNG.byteLength,
          modelVisible: true,
        }],
        createdAt: '2026-07-18T00:00:00.000Z',
        status: 'complete',
      }],
    };

    const events = [];
    for await (const event of client.stream(request)) events.push(event);

    expect(events).toEqual([
      {
        type: 'text_delta',
        text: IMAGE_INPUT_FALLBACK_NOTICE,
      },
      { type: 'text_delta', text: 'continued without image' },
    ]);
    expect(inner.requests).toHaveLength(2);
    expect(JSON.stringify(inner.requests[0])).toContain('data:image/png;base64');
    expect(JSON.stringify(inner.requests[1])).not.toContain('data:image/png;base64');
    expect(inner.requests[1]?.messages).toContainEqual(expect.objectContaining({
      role: 'developer',
      visibility: 'model',
      content: expect.stringContaining('Do not mention, restate, translate, or repeat'),
    }));
    expect(JSON.stringify(request)).not.toContain(ONE_PIXEL_PNG.toString('base64'));

    const followUpRequest: ModelRequest = {
      ...request,
      messages: [
        ...request.messages,
        {
          id: 'fallback_assistant',
          turnId: 'turn_1',
          role: 'assistant',
          content: `${IMAGE_INPUT_FALLBACK_NOTICE}${IMAGE_INPUT_FALLBACK_NOTICE}continued without image`,
          createdAt: '2026-07-18T00:00:01.000Z',
          status: 'complete',
        },
        {
          id: 'new_tool_message',
          turnId: 'turn_1',
          role: 'tool',
          toolCallId: 'call_new_image',
          toolName: 'view_image',
          content: 'Loaded new.png.',
          attachments: [{
            id: 'new_visible_image',
            assetId: 'asset_new_visible',
            source: 'generated',
            name: 'new.png',
            type: 'image/png',
            size: ONE_PIXEL_PNG.byteLength,
            modelVisible: true,
          }],
          createdAt: '2026-07-18T00:00:02.000Z',
          status: 'complete',
        },
      ],
    };
    const followUpEvents = [];
    for await (const event of client.stream(followUpRequest)) followUpEvents.push(event);

    expect(followUpEvents).toEqual([{ type: 'text_delta', text: 'continued without image' }]);
    expect(inner.requests).toHaveLength(3);
    expect(JSON.stringify(inner.requests[2])).not.toContain('data:image/png;base64');
    expect(JSON.stringify(inner.requests[2])).not.toContain(IMAGE_INPUT_FALLBACK_NOTICE.trim());
    expect(inner.requests[2]?.messages.find((message) => message.id === 'new_tool_message')?.attachments).toBeUndefined();
    expect(inner.requests[2]?.messages).toContainEqual(expect.objectContaining({
      id: 'runtime_image_input_fallback',
      role: 'developer',
    }));
    expect(read).toHaveBeenCalledOnce();
  });

  it('strips historical notices while hydrating a new image in a later turn', async () => {
    const inner = new CapturingModelClient();
    const read = vi.fn(async (assetId: string) => ({ name: `${assetId}.png`, type: 'image/png', data: ONE_PIXEL_PNG }));
    const client = new ImageAssetResolvingModelClient(inner, { read });
    const imageAttachment = (id: string) => ({
      id,
      assetId: id,
      source: 'generated' as const,
      name: `${id}.png`,
      type: 'image/png',
      size: ONE_PIXEL_PNG.byteLength,
      modelVisible: true,
    });
    const request: ModelRequest = {
      model: 'vision-model',
      stepSnapshot: {
        threadId: 'thread_1',
        turnId: 'turn_2',
        threadLastSeq: 2,
        conversationMessageIds: ['old_tool_message', 'fallback_assistant', 'new_tool_message'],
        messageIds: ['old_tool_message', 'fallback_assistant', 'new_tool_message'],
        toolNames: ['view_image'],
        selectedSkills: [],
        mcpServerKeys: [],
        mcpServerCount: 0,
        permissionProfile: 'workspace-write',
        featureKeys: [],
        worldState: { threadMessageCount: 3, threadUpdatedAt: '2026-07-18T00:00:02.000Z' },
      },
      messages: [
        {
          id: 'old_tool_message',
          turnId: 'turn_1',
          role: 'tool',
          toolCallId: 'call_old_image',
          toolName: 'view_image',
          content: 'Loaded old.png.',
          attachments: [imageAttachment('old_image')],
          createdAt: '2026-07-18T00:00:00.000Z',
          status: 'complete',
        },
        {
          id: 'fallback_assistant',
          turnId: 'turn_1',
          role: 'assistant',
          content: `${IMAGE_INPUT_FALLBACK_NOTICE}${IMAGE_INPUT_FALLBACK_NOTICE}kept assistant evidence`,
          createdAt: '2026-07-18T00:00:01.000Z',
          status: 'complete',
        },
        {
          id: 'new_tool_message',
          turnId: 'turn_2',
          role: 'tool',
          toolCallId: 'call_new_image',
          toolName: 'view_image',
          content: 'Loaded new.png.',
          attachments: [imageAttachment('new_image')],
          createdAt: '2026-07-18T00:00:02.000Z',
          status: 'complete',
        },
      ],
    };

    for await (const _event of client.stream(request)) {
      // Drain the request so the async generator reaches the wrapped client.
    }

    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith('new_image');
    expect(JSON.stringify(inner.request)).not.toContain(IMAGE_INPUT_FALLBACK_NOTICE.trim());
    expect(inner.request?.messages.find((message) => message.id === 'fallback_assistant')?.content).toBe('kept assistant evidence');
    expect(inner.request?.messages.find((message) => message.id === 'old_tool_message')?.attachments).toBeUndefined();
    expect(inner.request?.messages.find((message) => message.id === 'new_tool_message')?.attachments).toEqual([
      expect.objectContaining({
        id: 'new_image',
        url: expect.stringContaining('data:image/png;base64'),
      }),
    ]);
  });
});

async function largePng(): Promise<Buffer> {
  return sharp({ create: { width: 256, height: 128, channels: 4, background: '#579acd' } })
    .png({ compressionLevel: 0 }).toBuffer();
}

function imageRequest(data: Buffer): ModelRequest {
  return {
    providerId: 'provider', model: 'vision-model',
    messages: [{
      id: 'user', role: 'user', content: 'Keep all context and inspect the image.',
      createdAt: '2026-09-17T00:00:00Z', status: 'complete',
      attachments: [{
        id: 'user-image', name: 'screen.png', source: 'inline', type: 'image/png',
        size: data.length, url: `data:image/png;base64,${data.toString('base64')}`,
      }],
    }],
  };
}

class CapturingModelClient implements ModelClient {
  request?: ModelRequest;

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.request = request;
    yield { type: 'text_delta', text: 'ok' };
  }
}

class RejectFirstImageModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      throw new Error("input new_sensitive, messages[79]'s content[1] image is sensitive, please check your input (1026)");
    }
    yield { type: 'text_delta', text: 'continued without image' };
  }
}
