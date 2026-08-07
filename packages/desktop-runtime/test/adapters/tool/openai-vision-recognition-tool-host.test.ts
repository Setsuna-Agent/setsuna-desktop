import {
  OPENAI_VISION_RECOGNITION_PLUGIN_ID,
  OPENAI_VISION_RECOGNITION_TOOL_NAME,
  type ModelRequest,
  type ModelStreamEvent,
  type RuntimeConfigState,
  type RuntimeMessageAttachment,
  type RuntimeStoredMessageAttachment,
  type RuntimeThread,
  type RuntimeUsage,
  type RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenAiVisionRecognitionToolHost } from '../../../src/adapters/tool/openai-vision-recognition-tool-host.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('OpenAiVisionRecognitionToolHost', () => {
  it('advertises the tool only for an installed plugin with an enabled image-capable model selection', async () => {
    const installed = pluginStore(true);
    const host = toolHost(configStore(runtimeConfig()), installed);

    await expect(host.listTools({ threadId: 'thread_1' })).resolves.toEqual([
      expect.objectContaining({ name: OPENAI_VISION_RECOGNITION_TOOL_NAME }),
    ]);
    await expect(host.listTools({ threadId: 'thread_1', features: { plugins: false } })).resolves.toEqual([]);
    await expect(host.toolRuntimeProfile(OPENAI_VISION_RECOGNITION_TOOL_NAME)).resolves.toEqual({
      exposure: 'direct',
      supportsParallel: false,
      plugin: {
        id: OPENAI_VISION_RECOGNITION_PLUGIN_ID,
        name: '视觉识别',
        icon: 'vision-recognition',
      },
    });

    await expect(toolHost(configStore(runtimeConfig({ selected: false })), installed)
      .listTools({ threadId: 'thread_1' })).resolves.toEqual([]);
    await expect(toolHost(configStore(runtimeConfig({ supportsImages: false })), installed)
      .listTools({ threadId: 'thread_1' })).resolves.toEqual([]);
    await expect(toolHost(configStore(runtimeConfig({ modelEnabled: false })), installed)
      .listTools({ threadId: 'thread_1' })).resolves.toEqual([]);
    await expect(toolHost(configStore(runtimeConfig()), pluginStore(false))
      .listTools({ threadId: 'thread_1' })).resolves.toEqual([]);
  });

  it('reuses the selected configured model for a current-thread attachment', async () => {
    const fixture = await imageFixture();
    const capturedRequests: ModelRequest[] = [];
    const host = toolHost(
      configStore(runtimeConfig()),
      pluginStore(true),
      fixture,
      modelClient((request) => { capturedRequests.push(request); }),
    );

    const result = await host.runTool(OPENAI_VISION_RECOGNITION_TOOL_NAME, {
      attachment_id: fixture.attachment.assetId,
      prompt: 'Describe this image.',
    }, { threadId: 'thread_1', toolCallId: 'call_1' });

    expect(capturedRequests[0]).toMatchObject({
      providerId: 'vision-provider',
      model: 'qwen-vl-max',
      tools: [],
      toolChoice: 'none',
      messages: [{
        role: 'user',
        content: 'Describe this image.',
        attachments: [{
          id: fixture.attachment.assetId,
          name: 'diagram.png',
          type: 'image/png',
          source: 'inline',
          modelVisible: true,
        }],
      }],
    });
    expect(capturedRequests[0]?.messages[0]?.attachments?.[0]?.url)
      .toBe(`data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`);
    expect(result).toMatchObject({
      content: expect.stringContaining('The image contains one small colored pixel.'),
      preview: 'The image contains one small colored pixel.',
      containsExternalContext: true,
      data: {
        pluginId: OPENAI_VISION_RECOGNITION_PLUGIN_ID,
        attachmentId: fixture.attachment.assetId,
        providerId: 'vision-provider',
        modelId: 'vision-model-id',
        model: 'qwen-vl-max',
      },
    });
    expect(JSON.stringify(result)).not.toContain(ONE_PIXEL_PNG.toString('base64'));
    expect(JSON.stringify(result)).not.toContain(fixture.absolutePath);
  });

  it('accepts a legacy inline image and exposes its id to the model prompt', async () => {
    const inlineAttachment: RuntimeMessageAttachment = {
      id: 'inline_image_1',
      name: 'inline.png',
      type: 'image/png',
      size: ONE_PIXEL_PNG.byteLength,
      source: 'inline',
      url: `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`,
    };
    const capturedRequests: ModelRequest[] = [];
    const host = toolHost(
      configStore(runtimeConfig()),
      pluginStore(true),
      { thread: runtimeThread([inlineAttachment]) },
      modelClient((request) => { capturedRequests.push(request); }),
    );

    await expect(host.systemPrompt({
      threadId: 'thread_1',
      modelCapabilities: { supportsImages: true },
    })).resolves.toContain('inline_image_1');
    await expect(host.runTool(OPENAI_VISION_RECOGNITION_TOOL_NAME, {
      attachment_id: 'inline_image_1',
      prompt: 'Use the configured vision model.',
    }, { threadId: 'thread_1', turnId: 'turn_1' })).resolves.toMatchObject({
      data: { attachmentId: 'inline_image_1' },
    });
    expect(capturedRequests[0]?.messages[0]?.attachments?.[0]?.url).toBe(inlineAttachment.url);
  });

  it('records usage reported by the configured vision model for the active turn', async () => {
    const fixture = await imageFixture();
    const records: Array<Omit<RuntimeUsageRecord, 'id'>> = [];
    const usage: RuntimeUsage = {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    };
    const host = toolHost(
      configStore(runtimeConfig()),
      pluginStore(true),
      fixture,
      modelClient(() => undefined, 'Usage recorded.', usage),
      {
        clock: { now: () => new Date('2026-08-08T01:02:03.000Z') },
        usageStore: {
          async recordUsage(input) {
            records.push(input);
            return { id: 'usage_1', ...input };
          },
        },
      },
    );

    await host.runTool(OPENAI_VISION_RECOGNITION_TOOL_NAME, {
      attachment_id: fixture.attachment.assetId,
      prompt: 'Count usage.',
    }, { threadId: 'thread_1', turnId: 'turn_1' });

    expect(records).toEqual([{
      ...usage,
      threadId: 'thread_1',
      turnId: 'turn_1',
      createdAt: '2026-08-08T01:02:03.000Z',
      providerId: 'vision-provider',
      provider: 'Configured Vision',
      model: 'qwen-vl-max',
    }]);
  });

  it('does not invoke the model for an attachment absent from the current thread', async () => {
    const fixture = await imageFixture();
    let requestCount = 0;
    const host = toolHost(
      configStore(runtimeConfig()),
      pluginStore(true),
      { ...fixture, thread: runtimeThread([]) },
      modelClient(() => { requestCount += 1; }),
    );

    await expect(host.runTool(OPENAI_VISION_RECOGNITION_TOOL_NAME, {
      attachment_id: fixture.attachment.assetId,
      prompt: 'Describe it.',
    }, { threadId: 'thread_1' })).rejects.toThrow('当前会话中没有可用的图片附件');
    expect(requestCount).toBe(0);
  });

  it('uses a built-in image with the selected configured model for the quick test', async () => {
    const capturedRequests: ModelRequest[] = [];
    const host = toolHost(
      configStore(runtimeConfig()),
      pluginStore(true),
      undefined,
      modelClient((request) => { capturedRequests.push(request); }, 'Image received.'),
    );

    await expect(host.testRecognition({ prompt: 'Confirm image access.' })).resolves.toMatchObject({
      content: 'Image received.',
      durationMs: expect.any(Number),
      model: 'qwen-vl-max',
    });
    expect(capturedRequests[0]).toMatchObject({
      providerId: 'vision-provider',
      model: 'qwen-vl-max',
      messages: [{ attachments: [{ url: expect.stringMatching(/^data:image\/png;base64,/u) }] }],
    });
  });
});

function runtimeConfig(options: {
  selected?: boolean;
  supportsImages?: boolean;
  modelEnabled?: boolean;
} = {}): RuntimeConfigState {
  const selected = options.selected !== false;
  return {
    configPath: 'C:\\runtime\\config.json',
    dataPath: 'C:\\runtime',
    storagePath: 'C:\\runtime\\memories',
    activeProviderId: 'vision-provider',
    providers: [{
      id: 'vision-provider',
      name: 'Configured Vision',
      provider: 'openai-compatible',
      baseUrl: 'https://vision.example.test/v1',
      enabled: true,
      apiKeySet: true,
      apiKeyPreview: 'vis••••cret',
      models: [{
        id: 'vision-model-id',
        name: 'Qwen Vision',
        code: 'qwen-vl-max',
        enabled: options.modelEnabled !== false,
        maxOutputTokens: 8_192,
        thinkingEnabled: false,
        thinkingEfforts: [],
        supportsImages: options.supportsImages !== false,
      }],
    }],
    globalPrompt: '',
    memory: {
      useMemories: false,
      generateMemories: false,
      disableOnExternalContext: false,
    },
    memoryEnabled: false,
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
    ...(selected ? {
      visionRecognition: { providerId: 'vision-provider', modelId: 'vision-model-id' },
    } : {}),
  };
}

function configStore(value: RuntimeConfigState) {
  return { async getConfig() { return value; } };
}

function pluginStore(installed: boolean) {
  return {
    async listPlugins() {
      return {
        plugins: installed ? [{
          id: OPENAI_VISION_RECOGNITION_PLUGIN_ID,
          name: '视觉识别',
          icon: 'vision-recognition',
          installedAt: '2026-08-08T00:00:00.000Z',
          tools: [{ name: OPENAI_VISION_RECOGNITION_TOOL_NAME }],
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

function modelClient(
  onRequest: (request: ModelRequest) => void = () => undefined,
  text = 'The image contains one small colored pixel.',
  usage?: RuntimeUsage,
) {
  return {
    async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
      onRequest(request);
      yield { type: 'text_delta', text };
      if (usage) yield { type: 'usage', usage };
    },
  };
}

async function imageFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-vision-tool-test-'));
  const absolutePath = path.join(root, 'diagram.png');
  await writeFile(absolutePath, ONE_PIXEL_PNG);
  const attachment: RuntimeStoredMessageAttachment = {
    id: 'attachment_message_1',
    name: 'diagram.png',
    type: 'image/png',
    size: ONE_PIXEL_PNG.byteLength,
    source: 'runtime',
    assetId: 'attachment_asset_1',
  };
  return { absolutePath, attachment, thread: runtimeThread([attachment]) };
}

function runtimeThread(attachments: RuntimeMessageAttachment[]): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Vision test',
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    archived: false,
    messageCount: 1,
    lastMessagePreview: 'Analyze attachment',
    lastSeq: 0,
    messages: [{
      id: 'message_1',
      role: 'user',
      content: 'Analyze attachment',
      createdAt: '2026-08-08T00:00:00.000Z',
      attachments,
    }],
  };
}

type VisionToolFixture = {
  absolutePath?: string;
  attachment?: RuntimeStoredMessageAttachment;
  thread: RuntimeThread;
};

function toolHost(
  config: ReturnType<typeof configStore>,
  plugins: ReturnType<typeof pluginStore>,
  fixture?: VisionToolFixture,
  client = modelClient(),
  options: ConstructorParameters<typeof OpenAiVisionRecognitionToolHost>[5] = {},
) {
  const activeFixture = fixture;
  return new OpenAiVisionRecognitionToolHost(
    config,
    plugins,
    {
      async resolveForThread(threadId, attachments) {
        if (!activeFixture?.attachment
          || !activeFixture.absolutePath
          || threadId !== activeFixture.thread.id
          || attachments[0]?.assetId !== activeFixture.attachment.assetId) return [];
        return [{
          attachment: activeFixture.attachment,
          absolutePath: activeFixture.absolutePath,
          readableRoot: path.dirname(activeFixture.absolutePath),
        }];
      },
    },
    { async getThread() { return activeFixture?.thread ?? runtimeThread([]); } },
    client,
    options,
  );
}
