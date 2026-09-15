import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ModelProviderSettingsInput, ModelProviderSettingsState } from '../../src/contracts/index.js';
import type { ModelProviderClient } from '../../src/renderer/client.js';
import { ModelProviderRendererStateService } from '../../src/renderer/service.js';

describe('ModelProviderRendererStateService', () => {
  it('refreshes catalog metadata without overwriting staged settings and ignores older refresh responses', async () => {
    const state = stateFixture();
    const oldResponse = deferred<{ catalog: { providers: [] } }>();
    const newResponse = deferred<{ catalog: { providers: []; generatedAt: number } }>();
    const client: ModelProviderClient = {
      copyApiKey: async () => ({ ok: true }), read: async () => state, catalog: async () => ({ providers: [] }),
      discover: async () => ({ models: [] }), save: vi.fn(async () => state),
      refreshCatalog: vi.fn().mockImplementationOnce(() => oldResponse.promise).mockImplementationOnce(() => newResponse.promise),
    };
    const service = new ModelProviderRendererStateService(client, null);
    await service.refresh();
    const first = service.refreshCatalog({ catalogProviderId: 'deepseek' });
    const second = service.refreshCatalog({ catalogProviderId: 'opencode-go', force: true });
    const edited = { ...state, providers: state.providers.map((provider) => ({ ...provider, name: 'Unsaved' })) };
    service.stage(inputFromState(edited, 'draft-secret'), edited);
    newResponse.resolve({ catalog: { providers: [], generatedAt: 2 } });
    await second;
    oldResponse.resolve({ catalog: { providers: [] } });
    await first;
    expect(service.snapshot().catalog?.generatedAt).toBe(2);
    expect(service.snapshot().state).toEqual(edited);
    expect(client.save).not.toHaveBeenCalled();
    service.dispose();
  });

  it('serializes settings flushes and chat model selection against the latest staged provider state', async () => {
    const initial = stateFixture();
    const saves: ModelProviderSettingsInput[] = [];
    const gates = [deferred<ModelProviderSettingsState>(), deferred<ModelProviderSettingsState>()];
    const client: ModelProviderClient = {
      copyApiKey: async () => ({ ok: true }),
      catalog: async () => ({ providers: [] }),
      refreshCatalog: async () => ({ catalog: { providers: [] } }),
      discover: async () => ({ models: [] }),
      read: async () => initial,
      save: vi.fn(async (input) => {
        saves.push(structuredClone(input));
        return gates[saves.length - 1]!.promise;
      }),
    };
    const service = new ModelProviderRendererStateService(client, null);
    await service.refresh();
    const edited = {
      ...initial,
      providers: initial.providers.map((provider) => ({ ...provider, name: 'Edited provider', requestHeaders: { 'x-route': 'custom' } })),
    };
    service.stage(inputFromState(edited, 'new-secret'), edited);

    const flush = service.commit();
    const selection = service.selectProviderModel('provider-a', 'model-b');
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    gates[0]!.resolve(stateFromInput(saves[0]!));
    await flush;
    await vi.waitFor(() => expect(saves).toHaveLength(2));

    expect(saves[1]).toMatchObject({
      activeProviderId: 'provider-a',
      providers: [{
        name: 'Edited provider',
        apiKey: 'new-secret',
        requestHeaders: { 'x-route': 'custom' },
        models: [
          { id: 'model-a', enabled: false },
          { id: 'model-b', enabled: true },
        ],
      }],
    });
    gates[1]!.resolve(stateFromInput(saves[1]!));
    await selection;
  });
});

function stateFixture(): ModelProviderSettingsState {
  return {
    activeProviderId: 'provider-a',
    providers: [{
      id: 'provider-a',
      name: 'Provider A',
      provider: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [model('model-a', true), model('model-b', false)],
    }],
  };
}

function model(id: string, enabled: boolean): ProviderConfigState['models'][number] {
  return {
    id,
    name: id,
    code: id,
    enabled,
    maxOutputTokens: 8_192,
    thinkingEnabled: false,
    thinkingEfforts: [],
  };
}

function inputFromState(state: ModelProviderSettingsState, apiKey: string): ModelProviderSettingsInput {
  return {
    activeProviderId: state.activeProviderId,
    providers: state.providers.map((provider) => ({ ...provider, apiKey })),
  };
}

function stateFromInput(input: ModelProviderSettingsInput): ModelProviderSettingsState {
  return {
    activeProviderId: input.activeProviderId,
    providers: input.providers.map((provider) => ({
      id: provider.id!,
      name: provider.name!,
      provider: provider.provider!,
      baseUrl: provider.baseUrl!,
      enabled: provider.enabled ?? true,
      requestHeaders: provider.requestHeaders ?? undefined,
      apiKeySet: Boolean(provider.apiKey),
      apiKeyPreview: provider.apiKey ? 'sk-••••' : '',
      models: provider.models ?? [],
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
