import type {
  ProviderConfigState,
  RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import type { RuntimeFeatureSettingsDocumentHandle } from '@setsuna-desktop/feature-core/settings';
import {
  visionRecognitionFeature,
  type VisionRecognitionModelSelection,
  type VisionRecognitionRuntimeHost,
  type VisionRecognitionTextRequest,
} from '@setsuna-desktop/feature-vision-recognition/contracts';
import { RuntimeVisionRecognitionService } from '@setsuna-desktop/feature-vision-recognition/runtime';
import { describe, expect, it } from 'vitest';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('RuntimeVisionRecognitionService', () => {
  it('uses the selected image-capable model and records turn usage without exposing image bytes', async () => {
    const requests: VisionRecognitionTextRequest[] = [];
    const usageRecords: Array<Omit<RuntimeUsageRecord, 'id'>> = [];
    const service = await createService({
      providers: [provider(), provider({
        id: 'text-provider',
        models: [{ ...provider().models[0]!, id: 'text-model', supportsImages: false }],
      })],
      async generateText(input) {
        requests.push(input);
        return {
          content: '  The image contains one small colored pixel.  ',
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
        };
      },
      async recordUsage(input) { usageRecords.push(input); },
    });

    await expect(service.readSettings()).resolves.toMatchObject({
      selection: { providerId: 'vision-provider', modelId: 'vision-model' },
      health: 'ready',
      availableModels: [{ providerId: 'vision-provider', modelId: 'vision-model' }],
    });
    const result = await service.analyze({
      attachment_id: 'attachment_asset_1',
      prompt: 'Describe this image.',
    }, {
      threadId: 'thread_1',
      turnId: 'turn_1',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      providerId: 'vision-provider',
      model: 'qwen-vl-max',
      maxOutputTokens: 4_096,
      tools: [],
      toolChoice: 'none',
      messages: [{
        role: 'user',
        content: 'Describe this image.',
        attachments: [{
          id: 'attachment_asset_1',
          name: 'diagram.png',
          type: 'image/png',
          source: 'inline',
          modelVisible: true,
        }],
      }],
    });
    expect(requests[0]?.messages[0]?.attachments?.[0]?.url)
      .toBe(`data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`);
    expect(result).toEqual({
      content: 'The image contains one small colored pixel.',
      attachmentId: 'attachment_asset_1',
      attachmentName: 'diagram.png',
      providerId: 'vision-provider',
      modelId: 'vision-model',
      model: 'qwen-vl-max',
    });
    expect(JSON.stringify(result)).not.toContain(ONE_PIXEL_PNG.toString('base64'));
    expect(usageRecords).toEqual([{
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      threadId: 'thread_1',
      turnId: 'turn_1',
      createdAt: '2026-08-08T01:02:03.000Z',
      providerId: 'vision-provider',
      provider: 'Configured Vision',
      model: 'qwen-vl-max',
    }]);
  });

  it('keeps provider health degraded across settings refreshes until a retry succeeds', async () => {
    let attempts = 0;
    const service = await createService({
      async generateText() {
        attempts += 1;
        if (attempts === 1) throw new Error('temporarily unavailable');
        return { content: 'Recovered.' };
      },
    });
    const input = { attachment_id: 'attachment_asset_1', prompt: 'Describe it.' };
    const context = { threadId: 'thread_1' };

    const failure = await service.analyze(input, context).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Vision recognition provider is unavailable.',
    });
    expect(String(failure)).not.toContain('temporarily unavailable');
    await expect(service.readSettings()).resolves.toMatchObject({
      appliedRevision: 1,
      health: 'provider-unavailable',
    });
    await expect(service.analyze(input, context)).resolves.toMatchObject({ content: 'Recovered.' });
    await expect(service.readSettings()).resolves.toMatchObject({ health: 'ready' });
  });
});

type ServiceOverrides = Partial<VisionRecognitionRuntimeHost> & Readonly<{
  providers?: readonly ProviderConfigState[];
}>;

async function createService(overrides: ServiceOverrides = {}): Promise<RuntimeVisionRecognitionService> {
  const controller = createFeatureScope({
    featureId: visionRecognitionFeature.id,
    scopeId: `vision-recognition-test:${Date.now()}:${Math.random()}`,
    process: 'runtime',
  });
  controller.activate();
  const host: VisionRecognitionRuntimeHost = {
    async listProviders() { return overrides.providers ?? [provider()]; },
    async resolveImage() {
      return {
        id: 'attachment_asset_1',
        name: 'diagram.png',
        mimeType: 'image/png',
        data: ONE_PIXEL_PNG,
      };
    },
    async generateText() { return { content: 'Recognized.' }; },
    async recordUsage() {},
    now() { return new Date('2026-08-08T01:02:03.000Z'); },
    async isMarketplacePluginInstalled() { return true; },
    async readLegacySelection() { return null; },
    async retireLegacySelection() {},
    ...overrides,
  };
  const service = new RuntimeVisionRecognitionService(
    controller.scope,
    settingsHandle({ providerId: 'vision-provider', modelId: 'vision-model' }),
    host,
    { markActive() {}, markDegraded() {} },
    async () => ({
      featureId: visionRecognitionFeature.id,
      documentId: 'model-selection',
      status: 'ok',
      diagnosisId: 'test-diagnosis',
    }),
  );
  await service.initialize();
  return service;
}

function settingsHandle(
  selection: VisionRecognitionModelSelection,
): RuntimeFeatureSettingsDocumentHandle<
  VisionRecognitionModelSelection,
  VisionRecognitionModelSelection,
  VisionRecognitionModelSelection,
  undefined
> {
  let revision = 1;
  const listeners = new Set<(value: {
    value: VisionRecognitionModelSelection;
    revision: number;
  }) => void>();
  return {
    async exists() { return true; },
    async initialize() { return { value: selection, revision }; },
    async read() { return { value: selection, revision }; },
    async readPublic() { return { value: selection, revision }; },
    async readSecret() { return undefined; },
    async update(input) {
      if (input.expectedRevision !== revision) throw new Error('revision conflict');
      selection = input.patch;
      revision += 1;
      const value = { value: selection, revision };
      for (const listener of listeners) listener(value);
      return value;
    },
    subscribeRuntime(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function provider(overrides: Partial<ProviderConfigState> = {}): ProviderConfigState {
  return {
    id: 'vision-provider',
    name: 'Configured Vision',
    provider: 'openai-compatible',
    baseUrl: 'https://vision.example.test/v1',
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: 'vis••••cret',
    models: [{
      id: 'vision-model',
      name: 'Qwen Vision',
      code: 'qwen-vl-max',
      enabled: true,
      maxOutputTokens: 8_192,
      thinkingEnabled: false,
      thinkingEfforts: [],
      supportsImages: true,
    }],
    ...overrides,
  };
}
