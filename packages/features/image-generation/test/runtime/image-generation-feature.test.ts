import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { imageGenerationFeature } from '@setsuna-desktop/feature-image-generation/contracts';
import { describe, expect, it, vi } from 'vitest';
import { imageGenerationRuntimeFeature } from '../../src/runtime/feature.js';

describe('Image generation Feature migration', () => {
  it('retires legacy credentials only after the Feature settings can be applied', async () => {
    const invalidDocument = await setupFeature({ failure: 'document' });
    expect(invalidDocument.retire).not.toHaveBeenCalled();

    const unavailableSecret = await setupFeature({ failure: 'secret' });
    expect(unavailableSecret.retire).not.toHaveBeenCalled();

    const valid = await setupFeature({ failure: null });
    expect(valid.retire).toHaveBeenCalledTimes(1);
  });
});

async function setupFeature(options: Readonly<{ failure: 'document' | 'secret' | null }>) {
  const scope = createFeatureScope({
    featureId: imageGenerationFeature.id,
    process: 'runtime',
    scopeId: `image-generation-migration:${options.failure ?? 'none'}`,
  });
  const retire = vi.fn(async () => undefined);
  const settingsHandle = {
    async exists() { return true; },
    async initialize() { throw new Error('Existing settings must not be reinitialized.'); },
    async read() {
      if (options.failure === 'document') throw new Error('corrupt Feature settings');
      return {
        value: { baseUrl: 'https://images.example.test/v1', model: 'image-model' },
        revision: 1,
      };
    },
    async readPublic() { throw new Error('not used during setup'); },
    async readSecret() {
      if (options.failure === 'secret') throw new Error('unavailable secret revision');
      return 'sk-image-secret';
    },
    async update() { throw new Error('not used during setup'); },
    subscribeRuntime() { return () => undefined; },
  };

  await imageGenerationRuntimeFeature.setup({
    scope: scope.scope,
    dependencies: {
      routes: { register() {} },
      settings: {
        open: () => settingsHandle,
        diagnoseDocument: async () => ({
          featureId: imageGenerationFeature.id,
          documentId: 'connection',
          status: options.failure === null ? 'ok' : 'schema-invalid',
          diagnosisId: 'image-generation-migration-test',
        }),
      },
      generatedImages: {},
      references: {},
      network: {},
      workspaceFiles: null,
      legacySettings: {
        async read() { throw new Error('Existing settings must not re-import legacy data.'); },
        retire,
      },
    },
    health: { markActive() {}, markDegraded() {} },
    provide() {},
  });
  await scope.finishDispose();

  return { retire };
}
