import { access } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    await harness.close();
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
  
  it('returns real host dependency status without provisioning during startup', async () => {
      const status = await harness.runtimeFetch('/v1/workspace-dependencies');
      const disabled = await harness.runtimeFetch('/v1/workspace-dependencies', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false }),
      });
  
      expect(status).toMatchObject({
        enabled: true,
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
      expect(disabled).toMatchObject({ enabled: false, state: 'disabled' });
  
      const invalidResponse = await fetch(`${harness.baseUrl}/v1/workspace-dependencies`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${harness.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: 'yes' }),
      });
      expect(invalidResponse.status).toBe(400);
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
  
        const result = await harness.runtimeFetch('/v1/config/models', {
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
  
  it('generates git commit messages through the active model', async () => {
      const modelServer = await createOpenAiCaptureServer('feat: update git controls');
      try {
        await harness.configureOpenAiProvider('commit-message', modelServer.baseUrl);
  
        const result = await harness.runtimeFetch('/v1/git/commit-message/generate', {
          method: 'POST',
          body: JSON.stringify({
            branch: 'master',
            status: ' M src/chat.ts',
            diff: 'diff --git a/src/chat.ts b/src/chat.ts\n+const changed = true;\n',
          }),
        });
        const requestBody = await modelServer.nextBody;
  
        expect(JSON.stringify(requestBody)).toContain('src/chat.ts');
        expect(result).toEqual({ message: 'feat: update git controls' });
      } finally {
        await modelServer.close();
      }
    });
  
  it('falls back to a deterministic commit message when the active model returns no text', async () => {
      const modelServer = await createOpenAiCaptureServer('');
      try {
        await harness.configureOpenAiProvider('empty-commit-message', modelServer.baseUrl);
  
        const result = await harness.runtimeFetch('/v1/git/commit-message/generate', {
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
  
        const result = await harness.runtimeFetch('/v1/git/commit-message/generate', {
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
