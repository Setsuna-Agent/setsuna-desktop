import {
  OPENAI_IMAGE_GENERATION_PLUGIN_ID,
  OPENAI_IMAGE_GENERATION_TOOL_NAME,
  type RuntimeMessage,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { RuntimeImageGenerationProviderConfig } from '../../ports/config-store.js';
import { imageGenerationEndpoint, OpenAiImageGenerationToolHost } from './openai-image-generation-tool-host.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const MEBIBYTE = 1024 * 1024;

describe('OpenAiImageGenerationToolHost', () => {
  it('advertises the tool only when the plugin is installed and its private config is complete', async () => {
    const configured = config();
    const installed = pluginStore(true);
    const host = new OpenAiImageGenerationToolHost(
      configStore(configured), installed, generatedImageStore(), { fetchImpl: unusedFetch },
    );

    await expect(host.listTools({ threadId: 'thread_1' })).resolves.toEqual([
      expect.objectContaining({ name: OPENAI_IMAGE_GENERATION_TOOL_NAME }),
    ]);
    await expect(host.toolRuntimeProfile(OPENAI_IMAGE_GENERATION_TOOL_NAME)).resolves.toEqual({
      exposure: 'direct',
      supportsParallel: false,
      plugin: {
        id: OPENAI_IMAGE_GENERATION_PLUGIN_ID,
        name: '图片生成',
      },
    });
    await expect(new OpenAiImageGenerationToolHost(
      configStore({ ...configured, apiKey: '' }), installed, generatedImageStore(), { fetchImpl: unusedFetch },
    )
      .listTools({ threadId: 'thread_1' })).resolves.toEqual([]);
    await expect(new OpenAiImageGenerationToolHost(
      configStore(configured), pluginStore(false), generatedImageStore(), { fetchImpl: unusedFetch },
    )
      .listTools({ threadId: 'thread_1' })).resolves.toEqual([]);
  });

  it('calls an OpenAI-compatible generation endpoint and returns safe display-only attachments', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({
        created: 1,
        data: [{ b64_json: ONE_PIXEL_PNG.toString('base64'), revised_prompt: 'a revised prompt' }],
      });
    }) as typeof fetch;
    let storedImage: { name: string; type: string; data: Uint8Array } | null = null;
    let workspaceImage: { projectId: string; path: string; data: Uint8Array } | null = null;
    const host = new OpenAiImageGenerationToolHost(configStore(config()), pluginStore(true), {
      async clone() { return { assetId: 'unused_clone' }; },
      async create(input) {
        storedImage = input;
        return { assetId: 'generated_image_asset_1' };
      },
      async delete() {},
      async recover() {},
    }, {
      fetchImpl,
      workspaceProjects: {
        async writeBinaryFile(projectId, filePath, data) {
          workspaceImage = { projectId, path: filePath, data };
          return { projectId, path: filePath, size: data.byteLength, created: true };
        },
        async deleteFile() {},
      },
    });

    const result = await host.runTool(OPENAI_IMAGE_GENERATION_TOOL_NAME, {
      prompt: 'a small moon over the sea',
      n: 1,
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
      output_compression: 80,
    }, {
      threadId: 'thread_1',
      toolCallId: 'call/1',
      environment: {
        id: 'temporary_workspace.2026-07-18.thread_1',
        cwd: '/workspace',
        workspaceRoot: '/workspace',
        workspaceRoots: ['/workspace'],
      },
    });

    expect(requestUrl).toBe('http://images.example.test:8000/v1/images/generations');
    expect(requestInit?.headers).toMatchObject({
      Authorization: 'Bearer image-secret',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      prompt: 'a small moon over the sea',
      model: 'gpt-image-1',
      n: 1,
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
      output_compression: 80,
    });
    expect(result).toMatchObject({
      attachments: [{
        id: 'generated_image_call_1_1',
        name: 'generated-1.png',
        type: 'image/png',
        size: ONE_PIXEL_PNG.byteLength,
        modelVisible: false,
        source: 'generated',
        assetId: 'generated_image_asset_1',
      }],
      data: {
        pluginId: OPENAI_IMAGE_GENERATION_PLUGIN_ID,
        imageCount: 1,
        model: 'gpt-image-1',
        size: '1024x1024',
        workspaceFiles: [{
          projectId: 'temporary_workspace.2026-07-18.thread_1',
          path: 'generated-images/call_1-1.png',
        }],
      },
    });
    expect(storedImage).toMatchObject({ name: 'generated-1.png', type: 'image/png' });
    expect(Buffer.from(storedImage!.data)).toEqual(ONE_PIXEL_PNG);
    expect(workspaceImage).toMatchObject({
      projectId: 'temporary_workspace.2026-07-18.thread_1',
      path: 'generated-images/call_1-1.png',
    });
    expect(Buffer.from(workspaceImage!.data)).toEqual(ONE_PIXEL_PNG);
    expect(JSON.stringify(result.attachments)).not.toContain('data:image');
    expect(JSON.stringify(result.attachments)).not.toContain(ONE_PIXEL_PNG.toString('base64'));
    expect(JSON.stringify(result.data)).not.toContain('image-secret');
  });

  it('keeps the managed preview asset without mirroring it into a read-only workspace', async () => {
    let storedImage: { name: string; type: string; data: Uint8Array } | null = null;
    let workspaceWriteCount = 0;
    const host = new OpenAiImageGenerationToolHost(configStore(config()), pluginStore(true), {
      async clone() { return { assetId: 'unused_clone' }; },
      async create(input) {
        storedImage = input;
        return { assetId: 'generated_image_asset_read_only' };
      },
      async delete() {},
      async recover() {},
    }, {
      fetchImpl: (async () => Response.json({
        data: [{ b64_json: ONE_PIXEL_PNG.toString('base64') }],
      })) as typeof fetch,
      workspaceProjects: {
        async writeBinaryFile(projectId, filePath, data) {
          workspaceWriteCount += 1;
          return { projectId, path: filePath, size: data.byteLength, created: true };
        },
        async deleteFile() {},
      },
    });

    const result = await host.runTool(OPENAI_IMAGE_GENERATION_TOOL_NAME, { prompt: 'read-only preview' }, {
      threadId: 'thread_1',
      toolCallId: 'call_read_only',
      permissionProfile: 'read-only',
      environment: {
        id: 'temporary_workspace.2026-07-18.thread_1',
        cwd: '/workspace',
        workspaceRoot: '/workspace',
        workspaceRoots: ['/workspace'],
      },
    });

    expect(result).toMatchObject({
      attachments: [{ assetId: 'generated_image_asset_read_only', source: 'generated' }],
      data: {
        pluginId: OPENAI_IMAGE_GENERATION_PLUGIN_ID,
        imageCount: 1,
      },
    });
    expect(result.data).not.toHaveProperty('workspaceFiles');
    expect(storedImage).toMatchObject({ name: 'generated-1.png', type: 'image/png' });
    expect(workspaceWriteCount).toBe(0);
  });

  it('rolls back already stored images when a later response item is invalid', async () => {
    const deletedAssetIds: string[] = [];
    let nextAsset = 0;
    const host = new OpenAiImageGenerationToolHost(configStore(config()), pluginStore(true), {
      async clone() { return { assetId: 'unused_clone' }; },
      async create() {
        nextAsset += 1;
        return { assetId: `generated_image_asset_${nextAsset}` };
      },
      async delete(assetId) {
        deletedAssetIds.push(assetId);
      },
      async recover() {},
    }, {
      fetchImpl: (async () => Response.json({
        data: [
          { b64_json: ONE_PIXEL_PNG.toString('base64') },
          { b64_json: Buffer.from('not an image').toString('base64') },
        ],
      })) as typeof fetch,
    });

    await expect(host.runTool(
      OPENAI_IMAGE_GENERATION_TOOL_NAME,
      { prompt: 'two images' },
      { threadId: 'thread_1' },
    )).rejects.toThrow('不是受支持');
    expect(deletedAssetIds).toEqual(['generated_image_asset_1']);
  });

  it('downloads URL responses and surfaces OpenAI error messages', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/images/generations')) {
        return Response.json({ data: [{ url: '/generated/result.png' }] });
      }
      expect(url).toBe('https://images.example.test/generated/result.png');
      return new Response(ONE_PIXEL_PNG, { headers: { 'content-type': 'image/png' } });
    }) as typeof fetch;
    const host = new OpenAiImageGenerationToolHost(
      configStore(config({ baseUrl: 'https://images.example.test/v1' })),
      pluginStore(true),
      generatedImageStore(),
      { fetchImpl },
    );
    await expect(host.runTool(OPENAI_IMAGE_GENERATION_TOOL_NAME, { prompt: 'test' }, { threadId: 'thread_1' }))
      .resolves.toMatchObject({ attachments: [{ type: 'image/png' }] });

    const failingFetch = (async () => Response.json(
      { error: { message: 'model is unavailable for image-secret' } },
      { status: 400 },
    )) as typeof fetch;
    const failingHost = new OpenAiImageGenerationToolHost(
      configStore(config()), pluginStore(true), generatedImageStore(), { fetchImpl: failingFetch },
    );
    const failure = await failingHost
      .runTool(OPENAI_IMAGE_GENERATION_TOOL_NAME, { prompt: 'test' }, { threadId: 'thread_1' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('model is unavailable for [REDACTED]');
    expect((failure as Error).message).not.toContain('image-secret');
  });

  it('stops reading a streamed image response after the byte limit', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).endsWith('/images/generations')) {
        return Response.json({ data: [{ url: '/generated/oversized.png' }] });
      }
      let emittedChunks = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (emittedChunks >= 21) {
            controller.close();
            return;
          }
          emittedChunks += 1;
          controller.enqueue(chunk);
        },
      }));
    }) as typeof fetch;
    const host = new OpenAiImageGenerationToolHost(
      configStore(config()),
      pluginStore(true),
      generatedImageStore(),
      { fetchImpl },
    );

    await expect(host.runTool(
      OPENAI_IMAGE_GENERATION_TOOL_NAME,
      { prompt: 'oversized image' },
      { threadId: 'thread_1' },
    )).rejects.toThrow('20 MB');
  });

  it('rejects an announced JSON response above the bounded response limit', async () => {
    const host = new OpenAiImageGenerationToolHost(
      configStore(config()),
      pluginStore(true),
      generatedImageStore(),
      {
        fetchImpl: (async () => new Response('not json', {
          headers: { 'content-length': String(72 * MEBIBYTE) },
        })) as typeof fetch,
      },
    );

    await expect(host.runTool(
      OPENAI_IMAGE_GENERATION_TOOL_NAME,
      { prompt: 'oversized JSON response' },
      { threadId: 'thread_1' },
    )).rejects.toThrow('图片生成服务响应超过大小限制');
  });

  it('rolls back stored images when streamed downloads exceed the aggregate limit', async () => {
    const imageBytes = Math.floor((50 * MEBIBYTE) / 3) + 1;
    const createdAssets: Array<{ assetId: string; size: number }> = [];
    const deletedAssetIds: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).endsWith('/images/generations')) {
        return Response.json({
          data: [
            { url: '/generated/one.png' },
            { url: '/generated/two.png' },
            { url: '/generated/three.png' },
          ],
        });
      }
      return streamedPngResponse(imageBytes);
    }) as typeof fetch;
    const host = new OpenAiImageGenerationToolHost(configStore(config()), pluginStore(true), {
      async clone() { return { assetId: 'unused_clone' }; },
      async create(input) {
        const assetId = `generated_image_asset_${createdAssets.length + 1}`;
        createdAssets.push({ assetId, size: input.data.byteLength });
        return { assetId };
      },
      async delete(assetId) {
        deletedAssetIds.push(assetId);
      },
      async recover() {},
    }, { fetchImpl });

    await expect(host.runTool(
      OPENAI_IMAGE_GENERATION_TOOL_NAME,
      { prompt: 'three large images' },
      { threadId: 'thread_1' },
    )).rejects.toThrow('50 MB');
    expect(createdAssets).toEqual([
      { assetId: 'generated_image_asset_1', size: imageBytes },
      { assetId: 'generated_image_asset_2', size: imageBytes },
    ]);
    expect(deletedAssetIds).toEqual([
      'generated_image_asset_1',
      'generated_image_asset_2',
    ]);
  });

  it('releases turn assets only when no thread message committed their references', async () => {
    const deletedAssetIds: string[] = [];
    let nextAsset = 0;
    let messages: RuntimeMessage[] = [];
    const host = new OpenAiImageGenerationToolHost(
      configStore(config()),
      pluginStore(true),
      {
        async clone() { return { assetId: 'unused_clone' }; },
        async create() {
          nextAsset += 1;
          return { assetId: `generated_image_asset_${nextAsset}` };
        },
        async delete(assetId) {
          deletedAssetIds.push(assetId);
        },
        async recover() {},
      },
      {
        fetchImpl: (async () => Response.json({
          data: [{ b64_json: ONE_PIXEL_PNG.toString('base64') }],
        })) as typeof fetch,
        threadStore: {
          async listThreads() { return [{ id: 'thread_1' }]; },
          async getThread() { return { messages }; },
        },
      },
    );

    const committed = await host.runTool(
      OPENAI_IMAGE_GENERATION_TOOL_NAME,
      { prompt: 'committed image' },
      { threadId: 'thread_1', turnId: 'turn_committed' },
    );
    messages = [{
      id: 'msg_committed',
      role: 'assistant',
      content: '',
      createdAt: '2026-07-17T00:00:00.000Z',
      attachments: committed.attachments,
    }];
    await host.cleanupTurn?.(
      { threadId: 'thread_1', turnId: 'turn_committed' },
      { status: 'completed' },
    );
    expect(deletedAssetIds).toEqual([]);

    await host.runTool(
      OPENAI_IMAGE_GENERATION_TOOL_NAME,
      { prompt: 'uncommitted image' },
      { threadId: 'thread_1', turnId: 'turn_failed' },
    );
    await host.cleanupTurn?.(
      { threadId: 'thread_1', turnId: 'turn_failed' },
      { status: 'failed' },
    );
    expect(deletedAssetIds).toEqual(['generated_image_asset_2']);
  });
});

describe('imageGenerationEndpoint', () => {
  it.each([
    ['http://localhost:8000', 'http://localhost:8000/v1/images/generations'],
    ['http://localhost:8000/v1/', 'http://localhost:8000/v1/images/generations'],
    ['http://localhost:8000/api', 'http://localhost:8000/api/v1/images/generations'],
    ['http://localhost:8000/v1/images/generations/', 'http://localhost:8000/v1/images/generations'],
  ])('normalizes %s', (input, expected) => {
    expect(imageGenerationEndpoint(input)).toBe(expected);
  });
});

function config(overrides: Partial<RuntimeImageGenerationProviderConfig> = {}): RuntimeImageGenerationProviderConfig {
  return {
    baseUrl: 'http://images.example.test:8000',
    model: 'gpt-image-1',
    apiKey: 'image-secret',
    ...overrides,
  };
}

function configStore(value: RuntimeImageGenerationProviderConfig) {
  return { async getImageGenerationConfig() { return value; } };
}

function pluginStore(installed: boolean) {
  return {
    async listPlugins() {
      return {
        plugins: installed ? [{
          id: OPENAI_IMAGE_GENERATION_PLUGIN_ID,
          name: '图片生成',
          installedAt: '2026-07-17T00:00:00.000Z',
          skills: [],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
        }] : [],
      };
    },
  };
}

function generatedImageStore() {
  let index = 0;
  return {
    async clone() {
      index += 1;
      return { assetId: `generated_image_asset_${index}` };
    },
    async create() {
      index += 1;
      return { assetId: `generated_image_asset_${index}` };
    },
    async delete() {},
    async recover() {},
  };
}

const unusedFetch = (async () => {
  throw new Error('fetch should not be called');
}) as typeof fetch;

function streamedPngResponse(byteLength: number): Response {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const zeroChunk = new Uint8Array(MEBIBYTE);
  let remaining = byteLength;
  let emittedSignature = false;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!emittedSignature) {
        emittedSignature = true;
        remaining -= signature.byteLength;
        controller.enqueue(signature);
        return;
      }
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const chunkSize = Math.min(zeroChunk.byteLength, remaining);
      remaining -= chunkSize;
      controller.enqueue(chunkSize === zeroChunk.byteLength ? zeroChunk : zeroChunk.subarray(0, chunkSize));
    },
  }));
}
