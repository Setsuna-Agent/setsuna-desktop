// @vitest-environment happy-dom

import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  providerModelSelectionConfigInput,
  useRuntimeConfigState,
  type ModelProviderProjectionService,
  type RuntimeConfigClient,
} from '../../../../src/services/runtime-client/useRuntimeConfigState.js';

afterEach(cleanup);

describe('providerModelSelectionConfigInput', () => {
  it('enables only the selected model for the selected provider', () => {
    const config = runtimeConfig([
      provider('provider_a', false, [
        model('model_a', true),
        model('model_b', false),
      ]),
      provider('provider_b', true, [
        model('model_c', true),
      ]),
    ]);
    config.providers[0]!.catalogProviderId = 'openai';

    const input = providerModelSelectionConfigInput(config, 'provider_a', 'model_b');

    expect(input.activeProviderId).toBe('provider_a');
    expect(input.providers?.[0]).toMatchObject({
      id: 'provider_a',
      catalogProviderId: 'openai',
      enabled: true,
      proxyRoute: { mode: 'inherit' },
      models: [
        { id: 'model_a', enabled: false },
        { id: 'model_b', enabled: true },
      ],
    });
    expect(input.providers?.[1]).toMatchObject({
      id: 'provider_b',
      enabled: true,
      models: [{ id: 'model_c', enabled: true }],
    });
  });

  it('publishes the new-chat default before the config request finishes', async () => {
    const pending = deferred<RuntimeConfigState>();
    const initial = runtimeConfig([
      provider('provider_a', true, [model('model_a', true), model('model_b', false)]),
      provider('provider_b', true, [model('model_c', true)]),
    ]);
    initial.activeProviderId = 'provider_b';
    const saved = {
      ...initial,
      activeProviderId: 'provider_a',
      providers: initial.providers.map((item) => ({
        ...item,
        models: item.models.map((entry) => ({
          ...entry,
          enabled: item.id === 'provider_a' ? entry.id === 'model_b' : entry.enabled,
        })),
      })),
    };
    const client = {
      saveConfig: vi.fn(),
    } as unknown as RuntimeConfigClient;
    const modelProvider = projectionService(vi.fn(() => pending.promise));
    const { result } = renderHook(() => useRuntimeConfigState({ client, modelProvider }));
    act(() => result.current.replaceConfig(initial));

    let selection!: Promise<void>;
    act(() => {
      selection = result.current.selectProviderModel('provider_a', 'model_b');
    });

    expect(result.current.config).toMatchObject({
      activeProviderId: 'provider_a',
      providers: [
        { id: 'provider_a', models: [{ id: 'model_a', enabled: false }, { id: 'model_b', enabled: true }] },
        { id: 'provider_b' },
      ],
    });
    await act(async () => {
      pending.resolve(saved);
      await selection;
    });
  });

  it('rolls consecutive failed selections back to the last confirmed config', async () => {
    const firstSave = deferred<RuntimeConfigState>();
    const secondSave = deferred<RuntimeConfigState>();
    const initial = runtimeConfig([
      provider('provider_a', true, [
        model('model_a', true),
        model('model_b', false),
        model('model_c', false),
      ]),
    ]);
    initial.activeProviderId = 'provider_a';
    const client = {
      saveConfig: vi.fn(),
    } as unknown as RuntimeConfigClient;
    const selectProviderModel = vi.fn()
        .mockImplementationOnce(() => firstSave.promise)
        .mockImplementationOnce(() => secondSave.promise);
    const modelProvider = projectionService(selectProviderModel);
    const { result } = renderHook(() => useRuntimeConfigState({ client, modelProvider }));
    act(() => result.current.replaceConfig(initial));

    let selectB!: Promise<void>;
    act(() => {
      selectB = result.current.selectProviderModel('provider_a', 'model_b');
    });
    let selectC!: Promise<void>;
    act(() => {
      selectC = result.current.selectProviderModel('provider_a', 'model_c');
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.config?.providers[0]?.models).toMatchObject([
      { id: 'model_a', enabled: false },
      { id: 'model_b', enabled: false },
      { id: 'model_c', enabled: true },
    ]);
    expect(selectProviderModel).toHaveBeenCalledTimes(1);

    const firstRejected = expect(selectB).rejects.toThrow('B save failed');
    await act(async () => {
      firstSave.reject(new Error('B save failed'));
      await firstRejected;
    });
    expect(selectProviderModel).toHaveBeenCalledTimes(2);
    expect(result.current.config?.providers[0]?.models[2]).toMatchObject({
      id: 'model_c',
      enabled: true,
    });

    const secondRejected = expect(selectC).rejects.toThrow('C save failed');
    await act(async () => {
      secondSave.reject(new Error('C save failed'));
      await secondRejected;
    });
    expect(result.current.config).toBe(initial);
  });
});

function provider(
  id: string,
  enabled: boolean,
  models: ProviderModelConfig[] = [model(`${id}_model`, true)],
): ProviderConfigState {
  return {
    id,
    name: id,
    provider: 'openai-compatible',
    baseUrl: `https://${id}.example.com`,
    enabled,
    apiKeySet: true,
    apiKeyPreview: 'sk-…test',
    proxyRoute: { mode: 'inherit' },
    models,
  };
}

function model(id: string, enabled: boolean): ProviderModelConfig {
  return {
    id,
    name: id,
    code: id,
    enabled,
    maxOutputTokens: 4096,
    thinkingEnabled: false,
    thinkingEfforts: [],
  };
}

function runtimeConfig(providers: ProviderConfigState[]): RuntimeConfigState {
  return {
    configPath: '/data/config.json',
    dataPath: '/data',
    storagePath: '/data/storage',
    providers,
    globalPrompt: '',
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}

function projectionService(
  selectProviderModel: ModelProviderProjectionService['selectProviderModel'],
): ModelProviderProjectionService {
  return {
    providerProjection: () => null,
    selectProviderModel,
    subscribe: () => () => undefined,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
