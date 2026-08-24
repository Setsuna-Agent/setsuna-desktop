import type {
  MemoryRuntimeHost,
  MemoryStore,
} from '@setsuna-desktop/feature-memory/contracts';
import { memoryFeature } from '@setsuna-desktop/feature-memory/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import { memoryRuntimeFeature } from '../../src/runtime/feature.js';

describe('Memory Feature migration', () => {
  it('retires legacy settings only after the Feature document is readable', async () => {
    const invalid = await setupFeature({ settingsReadable: false });
    expect(invalid.retire).not.toHaveBeenCalled();
    expect(invalid.setCondition).toHaveBeenCalledWith('settings', {
      code: 'MEMORY_SETTINGS_INVALID',
      message: 'Memory settings could not be applied.',
    });

    const valid = await setupFeature({ settingsReadable: true });
    expect(valid.retire).toHaveBeenCalledTimes(1);
    expect(valid.setCondition).toHaveBeenCalledWith('settings', null);
  });
});

async function setupFeature(options: Readonly<{ settingsReadable: boolean }>) {
  const scope = createFeatureScope({
    featureId: memoryFeature.id,
    process: 'runtime',
    scopeId: `memory-migration:${options.settingsReadable}`,
  });
  const retire = vi.fn(async () => undefined);
  const setCondition = vi.fn();
  const settingsHandle = {
    async exists() { return true; },
    async initialize() { throw new Error('Existing settings must not be reinitialized.'); },
    async read() {
      if (!options.settingsReadable) throw new Error('corrupt Feature settings');
      return {
        value: {
          useMemories: true,
          generateMemories: true,
          disableOnExternalContext: false,
          extractionModel: null,
          consolidationModel: null,
        },
        revision: 1,
      };
    },
    async readPublic() { throw new Error('not used during setup'); },
    async readSecret() { return undefined; },
    async update() { throw new Error('not used during setup'); },
    subscribeRuntime() { return () => undefined; },
  };

  await memoryRuntimeFeature.setup({
    scope: scope.scope,
    dependencies: {
      routes: { register() {} },
      settings: {
        open: () => settingsHandle,
        diagnoseDocument: async () => ({
          featureId: memoryFeature.id,
          documentId: 'preferences',
          status: options.settingsReadable ? 'ok' : 'schema-invalid',
          diagnosisId: 'memory-migration-test',
        }),
      },
      host: memoryHost(),
      legacySettings: {
        async read() { throw new Error('Existing settings must not re-import legacy data.'); },
        retire,
      },
    },
    health: { setCondition },
    provide() {},
  });
  await scope.finishDispose();

  return { setCondition, retire };
}

function memoryHost(): MemoryRuntimeHost {
  return {
    store: {} as MemoryStore,
    now: () => new Date(0),
    id: (prefix) => `${prefix}_test`,
    listThreads: async () => [],
    getThread: async () => null,
    updateThreadMode: async () => { throw new Error('not used during setup'); },
    appendEvent: async () => undefined,
    streamModel: async function* streamModel() { yield* []; },
    recordUsage: async () => undefined,
    resolveModel: async ({ fallbackModel }) => ({ model: fallbackModel }),
    hasActiveModel: async () => false,
    listModelOptions: async () => [],
    sharedMemoryFilesEnabled: async () => false,
  };
}
