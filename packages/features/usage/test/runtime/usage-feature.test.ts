import type {
  UsageControl,
  UsageProviderDescriptor,
} from '@setsuna-desktop/feature-usage/contracts';
import {
  usageControlCapability,
  usageFeature,
} from '@setsuna-desktop/feature-usage/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { usageRuntimeFeature } from '../../src/runtime/feature.js';

describe('Usage runtime Feature', () => {
  it('keeps history available and omits the provider catalog from scoped queries', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-usage-feature-test-'));
    const scope = createFeatureScope({
      featureId: usageFeature.id,
      process: 'runtime',
      scopeId: 'usage-provider-projection-failure',
    });
    let control: UsageControl | undefined;
    let providerProjectionAvailable = false;
    let id = 0;
    const provider: UsageProviderDescriptor = {
      id: 'provider-a',
      name: 'Provider A',
      provider: 'openai-compatible',
      baseUrl: 'https://provider.example.test/v1',
      models: [{ code: 'model-a', name: 'Model A' }],
    };

    try {
      await usageRuntimeFeature.setup({
        scope: scope.scope,
        dependencies: {
          routes: {
            register() { return Object.freeze({ dispose() {} }); },
          },
          host: {
            dataDir,
            id: (prefix: string) => `${prefix}_${++id}`,
            async listProviders() {
              if (!providerProjectionAvailable) throw new Error('config unavailable');
              return [provider];
            },
          },
        },
        health: { setCondition() {} },
        provide(declaration, value) {
          if (declaration.token.id === usageControlCapability.id) {
            control = value as UsageControl;
          }
        },
      });
      if (!control) throw new Error('Usage control was not provided.');

      await control.recordUsage({
        threadId: 'thread_1',
        turnId: 'turn_1',
        createdAt: '2026-08-26T00:00:00.000Z',
        provider: 'openai-compatible',
        model: 'model-a',
        totalTokens: 42,
      });

      const degradedSnapshot = await control.query();

      expect(degradedSnapshot.providers).toEqual([]);
      expect(degradedSnapshot.usage.records).toHaveLength(1);
      expect(degradedSnapshot.usage.summary).toMatchObject({ recordCount: 1, totalTokens: 42 });

      providerProjectionAvailable = true;
      const threadSnapshot = await control.query({ threadId: 'thread_1' });
      const settingsSnapshot = await control.query();

      expect(threadSnapshot.providers).toEqual([]);
      expect(threadSnapshot.usage.records[0]).toMatchObject({
        providerId: 'provider-a',
        provider: 'Provider A',
      });
      expect(settingsSnapshot.providers).toEqual([provider]);
    } finally {
      await scope.finishDispose();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
