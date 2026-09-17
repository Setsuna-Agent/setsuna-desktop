import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryDesktopNativeBridge } from '../../support/in-memory-secret-store.js';
import { NativeBridgeProxyFetch } from '../../../src/adapters/network/native-bridge-proxy-fetch.js';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import {
  createModelListCaptureServer,
} from '../../support/runtime-server/rest-config-models.js';
import {
  createOpenAiCaptureServer
} from '../../support/runtime-server/shared.js';

describe('runtime server REST config and model discovery', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.close();
  });

  it('copies only the requested provider key to the native clipboard without exposing secrets in responses', async () => {
    const writeClipboard = vi.spyOn(InMemoryDesktopNativeBridge.prototype, 'writeClipboardText');
    await harness.runtimeFetch('/v1/features/model-provider/settings', {
      method: 'PUT',
      body: JSON.stringify({
        activeProviderId: 'active',
        providers: ['active', 'selected'].map((id) => ({
          id, name: id, provider: 'openai-compatible', baseUrl: 'https://example.com/v1',
          apiKey: `sk-${id}-secret`, models: [],
        })),
      }),
    });
    const copy = (input: unknown) => fetch(`${harness.baseUrl}/v1/features/model-provider/api-key/copy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${harness.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const savedCopy = await copy({ providerId: 'selected' });
    expect(savedCopy.status).toBe(200);
    expect(await savedCopy.json()).toEqual({ ok: true });
    expect(writeClipboard).toHaveBeenLastCalledWith('sk-selected-secret');

    const draftCopy = await copy({ providerId: 'selected', apiKey: ' sk-draft-secret ' });
    expect(draftCopy.status).toBe(200);
    expect(await draftCopy.json()).toEqual({ ok: true });
    expect(writeClipboard).toHaveBeenLastCalledWith('sk-draft-secret');
    await copy({ providerId: 'selected' });
    expect(writeClipboard).toHaveBeenLastCalledWith('sk-selected-secret');

    writeClipboard.mockClear();
    expect((await copy({ providerId: '' })).status).toBe(400);
    expect((await copy({ providerId: 'missing' })).status).toBe(409);
    expect(writeClipboard).not.toHaveBeenCalled();

    writeClipboard.mockRejectedValueOnce(new Error('Clipboard failed with sk-selected-secret'));
    const failedCopy = await copy({ providerId: 'selected' });
    expect(failedCopy.status).toBe(503);
    expect(await failedCopy.text()).not.toContain('sk-selected-secret');
    const settings = await harness.runtimeFetch('/v1/features/model-provider/settings');
    expect(JSON.stringify(settings)).not.toContain('sk-selected-secret');
    expect(JSON.stringify(settings)).not.toContain('sk-draft-secret');
  });

  it('persists compression levels through config requests and retains them across unrelated saves', async () => {
    expect(await harness.runtimeFetch('/v1/config')).toMatchObject({ imageCompression: 'high' });
    for (const imageCompression of ['original', 'lossless', 'high', 'compact', 'fast']) {
      expect(await harness.runtimeFetch('/v1/config', {
        method: 'PUT', body: JSON.stringify({ imageCompression }),
      })).toMatchObject({ imageCompression });
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT', body: JSON.stringify({ globalPrompt: 'Keep unrelated preferences.' }),
      });
      expect(await harness.runtimeFetch('/v1/config')).toMatchObject({ imageCompression });
    }
    expect(await harness.runtimeFetch('/v1/config', {
      method: 'PUT', body: JSON.stringify({ imageCompression: 'unknown' }),
    })).toMatchObject({ imageCompression: 'high' });
  });

  it('returns masked config without leaking API keys', async () => {
      const config = await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          providers: [
            {
              id: 'openai',
              name: 'OpenAI compatible',
              provider: 'openai-compatible',
              baseUrl: 'https://example.com/v1/',
              apiKey: 'sk-example-secret',
              models: [{ id: 'gpt', name: 'GPT', code: 'gpt-test', enabled: true, maxOutputTokens: 1000, thinkingEnabled: false, thinkingEfforts: [] }],
            },
          ],
        }),
      });
  
      expect(JSON.stringify(config)).not.toContain('sk-example-secret');
      expect(config.providers[0].baseUrl).toBe('https://example.com/v1/');
      expect(config.providers[0].apiKeySet).toBe(true);
    });

  it('projects Feature-owned Review settings through the legacy config route', async () => {
      const initial = await harness.runtimeFetch('/v1/config');
      const selection = {
        providerId: initial.providers[0].id,
        modelId: initial.providers[0].models[0].id,
      };

      const saved = await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({ taskModels: { review: selection } }),
      });
      const [read, featureSettings] = await Promise.all([
        harness.runtimeFetch('/v1/config'),
        harness.runtimeFetch('/v1/features/desktop-review/settings'),
      ]);

      expect(saved.taskModels.review).toEqual(selection);
      expect(read.taskModels.review).toEqual(selection);
      expect(featureSettings.selection).toEqual(selection);
    });

  it('keeps Core config readable and writable when Review settings are damaged', async () => {
      await writeFile(reviewSettingsPath(harness), '{"invalid":true}');

      const read = await harness.runtimeFetch('/v1/config');
      expect(read.taskModels).not.toHaveProperty('review');

      const saved = await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({ globalPrompt: 'Core remains repairable.' }),
      });
      expect(saved.globalPrompt).toBe('Core remains repairable.');
      expect(saved.taskModels).not.toHaveProperty('review');
    });

  it('rejects a mixed Core and Review compatibility write before either is committed', async () => {
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({ globalPrompt: 'keep this prompt' }),
      });
      const initial = await harness.runtimeFetch('/v1/config');
      const reviewBefore = await harness.runtimeFetch('/v1/features/desktop-review/settings');
      const selection = {
        providerId: initial.providers[0].id,
        modelId: initial.providers[0].models[0].id,
      };

      const response = await fetch(`${harness.baseUrl}/v1/config`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${harness.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          globalPrompt: 'must not be committed',
          taskModels: { review: selection },
        }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'mixed_review_config_write',
        error: 'Core config and Review settings must be written in separate requests.',
      });
      const [configAfter, reviewAfter] = await Promise.all([
        harness.runtimeFetch('/v1/config'),
        harness.runtimeFetch('/v1/features/desktop-review/settings'),
      ]);
      expect(configAfter.globalPrompt).toBe('keep this prompt');
      expect(reviewAfter).toMatchObject(reviewBefore);
    });

  it('coordinates proxy deletion with provider configuration writes', async () => {
      const config = await harness.runtimeFetch('/v1/config');
      const provider = config.providers[0];
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          providers: [{
            ...provider,
            name: 'Local models',
            proxyRoute: { mode: 'proxy', proxyServerId: 'proxy-example' },
          }],
        }),
      });

      const blocked = await fetch(`${harness.baseUrl}/v1/config/network-proxy/proxy-example`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${harness.token}` },
      });
      expect(blocked.status).toBe(409);
      await expect(blocked.json()).resolves.toMatchObject({
        code: 'network_proxy_in_use',
        error: expect.stringContaining('Local models'),
      });

      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          providers: [{ ...provider, proxyRoute: { mode: 'inherit' } }],
        }),
      });
      await expect(harness.runtimeFetch('/v1/config/network-proxy/proxy-example', {
        method: 'DELETE',
      })).resolves.toMatchObject({ servers: [] });
    });
  
  it('returns real host dependency status without provisioning during startup', async () => {
      const snapshot = await harness.runtimeFetch('/v1/features/workspace-dependencies');
      const status = snapshot.status;
      const diagnosed = await harness.runtimeFetch('/v1/features/workspace-dependencies/diagnose', { method: 'POST' });
  
      expect(status).toMatchObject({
        checks: expect.arrayContaining([
          expect.objectContaining({ id: 'sandbox', status: 'ok' }),
        ]),
      });
      const hostReady = status.node.available && status.python.available && status.uv.available;
      expect(status.state).toBe(hostReady ? 'ready' : 'not-installed');
      await expect(access(path.join(
        harness.runtimeDataDir,
        'runtime',
        'workspace-dependencies',
        'toolchain',
        'manifest.json',
      ))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(diagnosed).toMatchObject({ state: status.state });
    });
  
  it('fetches models with the selected provider saved API key', async () => {
      const modelServer = await createModelListCaptureServer();
      try {
        await harness.runtimeFetch('/v1/config', {
          method: 'PUT',
          body: JSON.stringify({
            activeProviderId: 'active-provider',
            providers: [
              {
                id: 'active-provider',
                name: 'Active provider',
                provider: 'openai-compatible',
                baseUrl: 'https://active.example/v1',
                apiKey: 'sk-active',
                enabled: true,
                models: [{ id: 'active', name: 'Active', code: 'active', enabled: true, maxOutputTokens: 1000, thinkingEnabled: false, thinkingEfforts: [] }],
              },
              {
                id: 'local-models',
                name: 'Local models',
                provider: 'openai-compatible',
                baseUrl: modelServer.baseUrl,
                apiKey: 'sk-model-list',
                enabled: true,
                models: [{ id: 'placeholder', name: 'Placeholder', code: 'placeholder', enabled: true, maxOutputTokens: 1000, thinkingEnabled: false, thinkingEfforts: [] }],
              },
            ],
          }),
        });
  
        const result = await harness.runtimeFetch('/v1/features/model-provider/models', {
          method: 'POST',
          body: JSON.stringify({ providerId: 'local-models' }),
        });
        const request = await modelServer.nextRequest;
  
        expect(request.url).toBe('/models');
        expect(request.authorization).toBe('Bearer sk-model-list');
        expect(result.models).toEqual([
          { id: 'llama3.1', name: 'Llama 3.1' },
          { id: 'qwen2.5', name: 'qwen2.5', maxOutputTokens: 8192, thinkingEnabled: true, thinkingEfforts: ['low', 'high'], supportsImages: true },
        ]);
      } finally {
        await modelServer.close();
      }
    });

  it('returns an actionable feature error for invalid model discovery input', async () => {
      const response = await fetch(`${harness.baseUrl}/v1/features/model-provider/models`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${harness.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId: 'missing-provider', baseUrl: '' }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        code: 'INVALID_INPUT',
        error: '请先填写模型服务地址。',
        retryable: false,
      });
    });

  it('preserves a safe provider error when model discovery is rejected upstream', async () => {
      const modelServer = await createModelListCaptureServer({
        status: 401,
        body: { error: { message: 'API key is invalid' } },
      });
      try {
        const response = await fetch(`${harness.baseUrl}/v1/features/model-provider/models`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${harness.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            provider: 'openai-compatible',
            baseUrl: modelServer.baseUrl,
            apiKey: 'invalid-key',
          }),
        });

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
          code: 'PROVIDER_UNAVAILABLE',
          error: '模型服务返回异常状态：401 - API key is invalid',
          retryable: true,
        });
      } finally {
        await modelServer.close();
      }
    });

  it('serves the filtered Pi built-in provider catalog to the renderer Feature', async () => {
      const catalog = await harness.runtimeFetch('/v1/features/model-provider/catalog');
      const deepseek = catalog.providers.find((provider: { id: string }) => provider.id === 'deepseek');

      expect(deepseek).toMatchObject({
        name: 'DeepSeek',
        plans: [expect.objectContaining({
          provider: 'openai-compatible',
          baseUrl: 'https://api.deepseek.com',
        })],
      });
      expect(deepseek.plans[0].models.length).toBeGreaterThan(0);
      expect(JSON.stringify(catalog)).not.toContain('apiKey');
    });

  it('refreshes public catalog metadata through the selected route and applies it to actual sampling', async () => {
    const modelServer = await createOpenAiCaptureServer('feat: use refreshed model');
    const remoteHeaders: Headers[] = [];
    const transport = vi.spyOn(NativeBridgeProxyFetch.prototype, 'forRoute').mockReturnValue(async (input, init) => {
      if (String(input) === 'https://pi.dev/api/models/providers/opencode-go') {
        remoteHeaders.push(new Headers(init?.headers));
        return Response.json([{
          id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', api: 'openai-completions',
          provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1',
          reasoning: true, input: ['text', 'image'], contextWindow: 1_000_000, maxTokens: 384_000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { thinkingFormat: 'deepseek', supportsDeveloperRole: false },
        }]);
      }
      return fetch(input, init);
    });
    try {
      await harness.runtimeFetch('/v1/features/model-provider/settings', {
        method: 'PUT', body: JSON.stringify({ activeProviderId: 'go', providers: [{
          id: 'go', catalogProviderId: 'opencode-go', provider: 'openai-compatible', name: 'Go',
          baseUrl: modelServer.baseUrl, apiKey: 'private-api-key', requestHeaders: { 'x-private': 'private-header' },
          proxyRoute: { mode: 'direct' }, enabled: true, models: [],
        }] }),
      });
      const result = await harness.runtimeFetch('/v1/features/model-provider/catalog/refresh', {
        method: 'POST', body: JSON.stringify({ catalogProviderId: 'opencode-go', providerId: 'go', force: true }),
      });
      expect(result.error).toBeUndefined();
      const provider = result.catalog.providers.find((item: { id: string }) => item.id === 'opencode-go');
      expect(provider.plans.some((plan: { models: { code: string }[] }) => plan.models.some((model) => model.code === 'deepseek-v4.1-flash'))).toBe(true);
      expect(transport).toHaveBeenCalledWith({ mode: 'direct' });
      expect(remoteHeaders).toHaveLength(1);
      const catalogHeaders: Record<string, string> = {};
      remoteHeaders[0].forEach((value, name) => { catalogHeaders[name] = value; });
      expect(catalogHeaders).toEqual({ accept: 'application/json', 'user-agent': 'setsuna-desktop/test' });
      await harness.runtimeFetch('/v1/features/model-provider/settings', {
        method: 'PUT', body: JSON.stringify({ providers: [{ id: 'go', models: [{
          id: 'new-model', code: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', enabled: true,
          thinkingEnabled: true, thinkingEfforts: ['high'], supportsImages: true,
        }] }] }),
      });
      expect(await harness.runtimeFetch('/v1/features/desktop-review/commit-message', {
        method: 'POST', body: JSON.stringify({ branch: 'master', status: ' M src/app.ts', diff: '+const updated = true;' }),
      })).toEqual({ message: 'feat: use refreshed model' });
      expect(await modelServer.nextBody).toMatchObject({ model: 'deepseek-v4.1-flash', thinking: { type: 'disabled' } });
      expect(modelServer.requestHeaders[0]).toMatchObject({ authorization: 'Bearer private-api-key', 'x-private': 'private-header' });
    } finally { await modelServer.close(); }
  });
  
  it('uses editable Go header defaults from saved settings when generating commit messages', async () => {
      const modelServer = await createOpenAiCaptureServer('feat: update git controls');
      try {
        await harness.runtimeFetch('/v1/features/model-provider/settings', {
          method: 'PUT',
          body: JSON.stringify({ activeProviderId: 'go', providers: [{
            id: 'go', name: 'Go', catalogProviderId: 'opencode-go', provider: 'openai-compatible',
            baseUrl: modelServer.baseUrl, apiKey: 'sk-test', enabled: true,
            models: [{ id: 'model', name: 'Model', code: 'model', enabled: true, thinkingEnabled: false, thinkingEfforts: [] }],
          }] }),
        });

        const generate = () => harness.runtimeFetch('/v1/features/desktop-review/commit-message', {
          method: 'POST',
          body: JSON.stringify({
            branch: 'master',
            status: ' M src/chat.ts',
            diff: 'diff --git a/src/chat.ts b/src/chat.ts\n+const changed = true;\n',
          }),
        });
        const result = await generate();
        await generate();
        const requestBody = await modelServer.nextBody;
  
        expect(JSON.stringify(requestBody)).toContain('src/chat.ts');
        expect(result).toEqual({ message: 'feat: update git controls' });
        expect(modelServer.requestHeaders).toHaveLength(2);
        for (const headers of modelServer.requestHeaders) {
          expect(headers['user-agent']).toBe('setsuna-desktop/test');
          expect(headers['x-opencode-session']).toMatch(/^commit_message_/u);
        }
        expect(modelServer.requestHeaders[0]['x-opencode-session'])
          .not.toBe(modelServer.requestHeaders[1]['x-opencode-session']);

        const saveHeaders = (requestHeaders: Record<string, string> | null) => harness.runtimeFetch('/v1/features/model-provider/settings', {
          method: 'PUT',
          body: JSON.stringify({ providers: [{ id: 'go', requestHeaders }] }),
        });
        const customHeaders = {
          'user-agent': 'my-app/{{appVersion}}',
          'x-opencode-session': 'custom-{{sessionId}}',
          'x-route': 'preferred',
        };
        await saveHeaders(customHeaders);
        const saved = await harness.runtimeFetch('/v1/features/model-provider/settings');
        expect(saved.providers[0].requestHeaders).toEqual(customHeaders);
        await generate();
        expect(modelServer.requestHeaders.at(-1)).toMatchObject({
          'user-agent': 'my-app/test',
          'x-opencode-session': expect.stringMatching(/^custom-commit_message_/u),
          'x-route': 'preferred',
        });

        await saveHeaders({});
        await generate();
        expect(modelServer.requestHeaders.at(-1)?.['user-agent']).toMatch(/^pi\b/u);
        expect(modelServer.requestHeaders.at(-1)?.['x-opencode-session']).toBeUndefined();
        expect(modelServer.requestHeaders.at(-1)?.['x-route']).toBeUndefined();

        await saveHeaders(null);
        await generate();
        expect(modelServer.requestHeaders.at(-1)).toMatchObject({
          'user-agent': 'setsuna-desktop/test',
          'x-opencode-session': expect.stringMatching(/^commit_message_/u),
        });
      } finally {
        await modelServer.close();
      }
    });
  
  it('falls back to a deterministic commit message when the active model returns no text', async () => {
      const modelServer = await createOpenAiCaptureServer('');
      try {
        await harness.configureOpenAiProvider('empty-commit-message', modelServer.baseUrl);
  
        const result = await harness.runtimeFetch('/v1/features/desktop-review/commit-message', {
          method: 'POST',
          body: JSON.stringify({
            branch: 'master',
            status: ' M src/chat.ts',
            diff: 'diff --git a/src/chat.ts b/src/chat.ts\n+const changed = true;\n',
          }),
        });
  
        expect(result).toEqual({ message: 'chore: update src/chat.ts' });
      } finally {
        await modelServer.close();
      }
    });
  
  it('falls back when the active model returns only invisible commit text', async () => {
      const modelServer = await createOpenAiCaptureServer('\u200B\u2060');
      try {
        await harness.configureOpenAiProvider('invisible-commit-message', modelServer.baseUrl);
  
        const result = await harness.runtimeFetch('/v1/features/desktop-review/commit-message', {
          method: 'POST',
          body: JSON.stringify({
            branch: 'master',
            status: ' M src/chat.ts',
            diff: 'diff --git a/src/chat.ts b/src/chat.ts\n+const changed = true;\n',
          }),
        });
  
        expect(result).toEqual({ message: 'chore: update src/chat.ts' });
      } finally {
        await modelServer.close();
      }
    });
});

function reviewSettingsPath(harness: RuntimeServerTestHarness): string {
  return path.join(
    harness.runtimeDataDir,
    'runtime',
    'features',
    'desktop-review',
    'settings',
    'model-selection.json',
  );
}
