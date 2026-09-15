import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPiModel } from '../../src/runtime/pi-context.js';
import { parseRemoteCatalog } from '../../src/runtime/remote-model-catalog-data.js';
import { RemoteModelCatalog } from '../../src/runtime/remote-model-catalog.js';

const directories: string[] = [];
const catalogs: RemoteModelCatalog[] = [];
afterEach(async () => {
  await Promise.all(catalogs.splice(0).map((catalog) => catalog.dispose()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('remote model catalog', () => {
  it('refreshes and restores an OpenRouter catalog containing both negative sentinel and regular prices', async () => {
    const directory = await temporaryDirectory();
    const catalog = createCatalog(directory);
    const sentinelCost = { input: -1_000_000, output: -1_000_000, cacheRead: 0, cacheWrite: 0 };
    const models = [
      ...['openrouter/auto', 'openrouter/auto-beta'].map((id) => remoteModel({ id, cost: sentinelCost })),
      remoteModel({ id: 'deepseek/updated-model', name: 'Updated model' }),
    ].map((model) => ({ ...model, provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' }));
    const fetch: typeof globalThis.fetch = async () => Response.json(models);
    const refreshed = await catalog.refresh('openrouter', fetch);
    expect(refreshed.error).toBeUndefined();
    expect(refreshed.catalog.providers.find((provider) => provider.id === 'openrouter')?.plans
      .flatMap((plan) => plan.models).find((model) => model.code === 'deepseek/updated-model'))
      .toMatchObject({ name: 'Updated model', contextWindowTokens: 1_000_000 });

    const restored = createCatalog(directory);
    await restored.restore();
    const restoredModels = restored.providers.find((provider) => provider.id === 'openrouter')!.getModels();
    for (const model of models) {
      expect(restoredModels.find((candidate) => candidate.id === model.id)).toMatchObject({
        name: model.name, cost: model.cost, contextWindow: model.contextWindow,
      });
    }
  });

  it.each([undefined, null, '0.15', NaN, Infinity, -Infinity])('rejects a non-finite or non-numeric price: %s', (input) => {
    expect(() => parseRemoteCatalog('openrouter', [remoteModel({ cost: { ...remoteModel().cost, input } })]))
      .toThrow('Invalid model catalog metadata.');
  });

  it('shares downloaded capabilities with settings and sampling, and restores them offline in a new runtime', async () => {
    const directory = await temporaryDirectory();
    const catalog = createCatalog(directory);
    const independent = createCatalog(await temporaryDirectory());
    const fetch = vi.fn(async () => remoteResponse()) as unknown as typeof globalThis.fetch;
    expect(findNewModel(catalog)).toBeUndefined();
    await catalog.refresh('opencode-go', fetch);
    expect(findNewModel(catalog)).toMatchObject({
      code: 'deepseek-v4.1-flash', supportsImages: true, contextWindowTokens: 1_000_000,
      thinkingEfforts: ['high', 'max'],
    });
    expect(findNewModel(independent)).toBeUndefined();
    const restored = createCatalog(directory);
    await restored.restore();
    expect(findNewModel(restored)).toEqual(findNewModel(catalog));
    expect(restored.snapshot().providers.find((provider) => provider.id === 'opencode-go')?.plans
      .flatMap((plan) => plan.models).some((model) => model.code === 'deepseek-v4-flash')).toBe(true);
    expect(createPiModel({
      id: 'go', catalogProviderId: 'opencode-go', name: 'Go', provider: 'openai-compatible',
      baseUrl: 'https://opencode.ai/zen/go/v1', apiKey: 'private', enabled: true, models: [],
    }, 'deepseek-v4.1-flash', { providers: restored.providers })).toMatchObject({
      api: 'openai-completions', input: ['text', 'image'], thinkingLevelMap: remoteModel().thinkingLevelMap,
      compat: { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' },
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://pi.dev/api/models/providers/opencode-go');
    expect(new Headers(init?.headers).get('user-agent')).toBe('setsuna-desktop/test');
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  });

  it('deduplicates concurrent refreshes, revalidates with ETag, and supports forced refresh within the cache interval', async () => {
    let now = 1_000;
    const catalog = createCatalog(await temporaryDirectory(), () => now);
    let release!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = catalog.refresh('opencode-go', fetch);
    const second = catalog.refresh('opencode-go', fetch, true);
    expect(first).toBe(second);
    release(remoteResponse());
    await first;
    await catalog.refresh('opencode-go', fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(new Response(null, { status: 304 }));
    await catalog.refresh('opencode-go', fetch, true);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('if-none-match')).toBe('"models-v1"');
    expect(findNewModel(catalog)).toBeDefined();
    now += 4 * 60 * 60 * 1000 + 1;
    await catalog.refresh('opencode-go', fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps the last valid catalog on network or malformed-data failures without publishing partial updates', async () => {
    const catalog = createCatalog(await temporaryDirectory());
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(remoteResponse());
    await catalog.refresh('opencode-go', fetch);
    const before = findNewModel(catalog);
    fetch.mockResolvedValue(new Response('offline', { status: 503 }));
    expect((await catalog.refresh('opencode-go', fetch, true)).error).toContain('503');
    fetch.mockResolvedValue(Response.json([remoteModel({ name: 'Changed' }), { id: 'broken', api: 'openai-completions' }]));
    expect((await catalog.refresh('opencode-go', fetch, true)).error).toContain('Invalid');
    expect(findNewModel(catalog)).toEqual(before);
    const restored = createCatalog(directories.at(-1)!);
    await restored.restore();
    expect(findNewModel(restored)).toEqual(before);
    expect(() => catalog.refresh('../unknown', fetch)).toThrow('Unknown');
  });

  it('starts with bundled models if the cache is corrupt and cancels refreshes when the runtime closes', async () => {
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, 'opencode-go.json'), '{broken');
    const scope = new AbortController();
    const catalog = new RemoteModelCatalog(directory, 'test', { signal: scope.signal });
    catalogs.push(catalog);
    await catalog.restore();
    expect(catalog.snapshot().providers.some((provider) => provider.id === 'opencode-go')).toBe(true);
    const fetch: typeof globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    });
    const pending = catalog.refresh('opencode-go', fetch);
    scope.abort();
    expect((await pending).error).toBeDefined();
    expect(findNewModel(catalog)).toBeUndefined();
  });
});

function createCatalog(directory: string, now?: () => number) {
  const catalog = new RemoteModelCatalog(directory, 'test', { now });
  catalogs.push(catalog);
  return catalog;
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-catalog-'));
  directories.push(directory);
  return directory;
}

function findNewModel(catalog: RemoteModelCatalog) {
  return catalog.snapshot().providers.find((provider) => provider.id === 'opencode-go')?.plans
    .flatMap((plan) => plan.models).find((model) => model.code === 'deepseek-v4.1-flash');
}

function remoteResponse() {
  return Response.json([remoteModel()], { headers: { etag: '"models-v1"', 'last-modified': 'Mon, 14 Sep 2026 12:40:23 GMT' } });
}

function remoteModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', api: 'openai-completions',
    baseUrl: 'https://opencode.ai/zen/go/v1', provider: 'opencode-go', reasoning: true, input: ['text', 'image'],
    contextWindow: 1_000_000, maxTokens: 384_000, cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', max: 'max' },
    compat: { thinkingFormat: 'deepseek', requiresReasoningContentOnAssistantMessages: true },
    ...overrides,
  };
}
