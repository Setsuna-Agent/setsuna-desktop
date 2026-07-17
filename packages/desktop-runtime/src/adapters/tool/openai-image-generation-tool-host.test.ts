import { OPENAI_IMAGE_GENERATION_PLUGIN_ID, OPENAI_IMAGE_GENERATION_TOOL_NAME } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { RuntimeImageGenerationProviderConfig } from '../../ports/config-store.js';
import { imageGenerationEndpoint, OpenAiImageGenerationToolHost } from './openai-image-generation-tool-host.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('OpenAiImageGenerationToolHost', () => {
  it('advertises the tool only when the plugin is installed and its private config is complete', async () => {
    const configured = config();
    const installed = pluginStore(true);
    const host = new OpenAiImageGenerationToolHost(configStore(configured), installed, unusedFetch);

    await expect(host.listTools({ threadId: 'thread_1' })).resolves.toEqual([
      expect.objectContaining({ name: OPENAI_IMAGE_GENERATION_TOOL_NAME }),
    ]);
    await expect(new OpenAiImageGenerationToolHost(configStore({ ...configured, apiKey: '' }), installed, unusedFetch)
      .listTools({ threadId: 'thread_1' })).resolves.toEqual([]);
    await expect(new OpenAiImageGenerationToolHost(configStore(configured), pluginStore(false), unusedFetch)
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
    const host = new OpenAiImageGenerationToolHost(configStore(config()), pluginStore(true), fetchImpl);

    const result = await host.runTool(OPENAI_IMAGE_GENERATION_TOOL_NAME, {
      prompt: 'a small moon over the sea',
      n: 1,
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
      output_compression: 80,
    }, { threadId: 'thread_1', toolCallId: 'call/1' });

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
        url: `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`,
      }],
      data: {
        pluginId: OPENAI_IMAGE_GENERATION_PLUGIN_ID,
        imageCount: 1,
        model: 'gpt-image-1',
        size: '1024x1024',
      },
    });
    expect(JSON.stringify(result.data)).not.toContain('image-secret');
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
      fetchImpl,
    );
    await expect(host.runTool(OPENAI_IMAGE_GENERATION_TOOL_NAME, { prompt: 'test' }, { threadId: 'thread_1' }))
      .resolves.toMatchObject({ attachments: [{ type: 'image/png' }] });

    const failingFetch = (async () => Response.json(
      { error: { message: 'model is unavailable for image-secret' } },
      { status: 400 },
    )) as typeof fetch;
    const failingHost = new OpenAiImageGenerationToolHost(configStore(config()), pluginStore(true), failingFetch);
    const failure = await failingHost
      .runTool(OPENAI_IMAGE_GENERATION_TOOL_NAME, { prompt: 'test' }, { threadId: 'thread_1' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('model is unavailable for [REDACTED]');
    expect((failure as Error).message).not.toContain('image-secret');
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

const unusedFetch = (async () => {
  throw new Error('fetch should not be called');
}) as typeof fetch;
