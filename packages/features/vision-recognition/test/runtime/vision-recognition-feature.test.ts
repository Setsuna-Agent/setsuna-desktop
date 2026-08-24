import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { visionRecognitionFeature } from '@setsuna-desktop/feature-vision-recognition/contracts';
import { describe, expect, it, vi } from 'vitest';
import { visionRecognitionRuntimeFeature } from '../../src/runtime/feature.js';

describe('Vision recognition Feature migration', () => {
  it('retires the legacy selection only after the Feature selection can be applied', async () => {
    const invalid = await setupFeature({ settingsReadable: false });
    expect(invalid.retire).not.toHaveBeenCalled();

    const valid = await setupFeature({ settingsReadable: true });
    expect(valid.retire).toHaveBeenCalledTimes(1);
  });
});

async function setupFeature(options: Readonly<{ settingsReadable: boolean }>) {
  const scope = createFeatureScope({
    featureId: visionRecognitionFeature.id,
    process: 'runtime',
    scopeId: `vision-recognition-migration:${options.settingsReadable}`,
  });
  const retire = vi.fn(async () => undefined);
  const selection = { providerId: 'vision-provider', modelId: 'vision-model' };
  const settingsHandle = {
    async exists() { return true; },
    async initialize() { throw new Error('Existing settings must not be reinitialized.'); },
    async read() {
      if (!options.settingsReadable) throw new Error('corrupt Feature settings');
      return { value: selection, revision: 1 };
    },
    async readPublic() { throw new Error('not used during setup'); },
    async readSecret() { return undefined; },
    async update() { throw new Error('not used during setup'); },
    subscribeRuntime() { return () => undefined; },
  };

  await visionRecognitionRuntimeFeature.setup({
    scope: scope.scope,
    dependencies: {
      routes: { register() {} },
      settings: {
        open: () => settingsHandle,
        diagnoseDocument: async () => ({
          featureId: visionRecognitionFeature.id,
          documentId: 'model-selection',
          status: options.settingsReadable ? 'ok' : 'schema-invalid',
          diagnosisId: 'vision-recognition-migration-test',
        }),
      },
      host: {
        async listProviders() { return [provider()]; },
        async readLegacySelection() { throw new Error('Existing settings must not re-import legacy data.'); },
        retireLegacySelection: retire,
      },
    },
    health: { setCondition() {} },
    provide() {},
  });
  await scope.finishDispose();

  return { retire };
}

function provider(): ProviderConfigState {
  return {
    id: 'vision-provider',
    name: 'Vision Provider',
    provider: 'openai-compatible',
    baseUrl: 'https://vision.example.test/v1',
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: 'vis••••cret',
    models: [{
      id: 'vision-model',
      name: 'Vision Model',
      code: 'vision-model',
      enabled: true,
      maxOutputTokens: 4_096,
      thinkingEnabled: false,
      thinkingEfforts: [],
      supportsImages: true,
    }],
  };
}
