import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

describe('runtime server AppServer config', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('reads AppServer v2 config with origins, layers, and feature enablement', async () => {
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'config-openai',
          globalPrompt: 'Prefer terse answers.',
          memoryEnabled: false,
          approvalPolicy: 'strict',
          approvalReviewer: 'automatic',
          permissionProfile: 'workspace-write',
          setsunaStyle: 'daily',
          taskModels: {
            review: { providerId: 'config-openai', modelId: 'reviewer' },
          },
          providers: [
            {
              id: 'config-openai',
              name: 'Config OpenAI',
              provider: 'openai-responses',
              baseUrl: 'https://api.config.test/v1',
              apiKey: 'sk-config-secret',
              enabled: true,
              models: [
                {
                  id: 'alpha',
                  name: 'GPT Alpha',
                  code: 'gpt-alpha',
                  enabled: true,
                  contextWindowTokens: 128000,
                  maxOutputTokens: 4000,
                  thinkingEnabled: true,
                  thinkingEfforts: ['low', 'high'],
                  defaultThinkingEffort: 'high',
                },
                {
                  id: 'reviewer',
                  name: 'Review Model',
                  code: 'review-model',
                  enabled: false,
                  maxOutputTokens: 4000,
                  thinkingEnabled: false,
                  thinkingEfforts: [],
                },
              ],
            },
          ],
        }),
      });
  
      const response = await harness.appServerRpc('config/read', { includeLayers: true, cwd: process.cwd() });
      expect(response.config).toMatchObject({
        model: 'gpt-alpha',
        review_model: 'review-model',
        model_context_window: 128000,
        model_provider: 'config-openai',
        approval_policy: 'untrusted',
        approvals_reviewer: 'automatic',
        sandbox_mode: 'workspace-write',
        instructions: 'Prefer terse answers.',
        model_reasoning_effort: 'high',
        features: {
          auth_elicitation: false,
          memories: false,
          mentions_v2: true,
          remote_control: false,
          remote_plugin: false,
        },
        desktop: {
          setsuna_style: 'daily',
          memory_enabled: false,
        },
        memories: {
          disable_on_external_context: false,
          generate_memories: false,
          use_memories: false,
        },
      });
      expect(response.config.sandbox_workspace_write).toMatchObject({
        writable_roots: [process.cwd()],
        network_access: true,
        exclude_tmpdir_env_var: false,
        exclude_slash_tmp: false,
      });
      expect(response.origins.model).toMatchObject({
        version: '1',
        name: {
          type: 'user',
          file: expect.stringContaining('config.json'),
          profile: null,
        },
      });
      expect(response.origins['memories.use_memories']).toMatchObject({
        version: '1',
        name: { type: 'user' },
      });
      expect(response.layers).toHaveLength(1);
      expect(response.layers[0]).toMatchObject({
        version: '1',
        name: { type: 'user', profile: null },
      });
      expect(JSON.stringify(response)).not.toContain('sk-config-secret');
  
      await expect(harness.appServerRpc('config/read', {})).resolves.not.toHaveProperty('layers');
    });
  
  it('writes AppServer v2 config values and batches into local config state', async () => {
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'write-openai',
          providers: [
            {
              id: 'write-openai',
              name: 'Write OpenAI',
              provider: 'openai-compatible',
              baseUrl: 'https://api.write.test/v1',
              enabled: true,
              models: [
                {
                  id: 'alpha',
                  name: 'GPT Alpha',
                  code: 'gpt-alpha',
                  enabled: true,
                  maxOutputTokens: 4000,
                  thinkingEnabled: true,
                  thinkingEfforts: ['medium'],
                  defaultThinkingEffort: 'medium',
                },
                {
                  id: 'beta',
                  name: 'GPT Beta',
                  code: 'gpt-beta',
                  enabled: false,
                  contextWindowTokens: 64000,
                  maxOutputTokens: 4000,
                  thinkingEnabled: false,
                  thinkingEfforts: [],
                },
              ],
            },
          ],
        }),
      });
  
      await expect(harness.appServerRpc('config/value/write', {
        keyPath: 'model',
        value: 'gpt-beta',
        mergeStrategy: 'replace',
      })).resolves.toMatchObject({
        status: 'ok',
        version: '1',
        filePath: expect.stringContaining('config.json'),
        overriddenMetadata: null,
      });
  
      await expect(harness.appServerRpc('config/batchWrite', {
        edits: [
          { keyPath: 'approval_policy', value: 'never', mergeStrategy: 'replace' },
          { keyPath: 'approvals_reviewer', value: 'automatic', mergeStrategy: 'replace' },
          { keyPath: 'review_model', value: 'gpt-alpha', mergeStrategy: 'replace' },
          { keyPath: 'sandbox_mode', value: 'workspace-write', mergeStrategy: 'replace' },
          {
            keyPath: 'sandbox_workspace_write',
            value: { writable_roots: ['D:/work'], network_access: true },
            mergeStrategy: 'replace',
          },
          { keyPath: 'features.memories', value: false, mergeStrategy: 'replace' },
          { keyPath: 'model_context_window', value: 32000, mergeStrategy: 'replace' },
          { keyPath: 'model_auto_compact_token_limit', value: 28000, mergeStrategy: 'replace' },
          { keyPath: 'desktop.selected-avatar-id', value: 'swe', mergeStrategy: 'replace' },
        ],
      })).resolves.toMatchObject({ status: 'ok', version: '1' });
  
      const read = await harness.appServerRpc('config/read', {});
      expect(read.config).toMatchObject({
        model: 'gpt-beta',
        model_context_window: 32000,
        model_auto_compact_token_limit: 28000,
        approval_policy: 'never',
        approvals_reviewer: 'automatic',
        review_model: 'gpt-alpha',
        sandbox_mode: 'workspace-write',
        sandbox_workspace_write: {
          writable_roots: ['D:/work'],
          network_access: true,
        },
        features: {
          memories: false,
        },
        desktop: {
          'selected-avatar-id': 'swe',
          memory_enabled: true,
        },
      });
    });
  
  it('writes AppServer memory settings without collapsing read and generate', async () => {
      await expect(harness.appServerRpc('config/batchWrite', {
        edits: [
          {
            keyPath: 'memories',
            value: {
              disable_on_external_context: false,
              generate_memories: false,
              min_rate_limit_remaining_percent: 0,
              max_rollouts_per_startup: 3,
            },
            mergeStrategy: 'replace',
          },
          { keyPath: 'memories.use_memories', value: true, mergeStrategy: 'replace' },
        ],
      })).resolves.toMatchObject({ status: 'ok', version: '1' });
  
      const read = await harness.appServerRpc('config/read', {});
      expect(read.config).toMatchObject({
        desktop: {
          memory_enabled: true,
        },
        features: {
          memories: false,
        },
        memories: {
          disable_on_external_context: false,
          generate_memories: false,
          use_memories: true,
          min_rate_limit_remaining_percent: 0,
          max_rollouts_per_startup: 3,
        },
      });
    });
  
  it('sets supported AppServer runtime feature enablement keys', async () => {
      await expect(harness.appServerRpc('experimentalFeature/enablement/set', {
        enablement: {
          memories: false,
          mentions_v2: false,
          unsupported_feature: true,
        },
      })).resolves.toEqual({
        enablement: {
          memories: false,
          mentions_v2: false,
        },
      });
  
      const config = await harness.appServerRpc('config/read', {});
      expect(config.config.features).toMatchObject({
        memories: false,
        mentions_v2: false,
      });
  
      const features = await harness.appServerRpc('experimentalFeature/list', {});
      expect(features.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'memories', enabled: false }),
        expect.objectContaining({ name: 'mentions_v2', enabled: false }),
      ]));
    });
  
  it('rejects AppServer config writes with stale expected versions', async () => {
      await expect(harness.appServerRpcEnvelope({
        id: 'stale_config_write',
        method: 'config/value/write',
        params: {
          keyPath: 'model',
          value: 'gpt-stale',
          mergeStrategy: 'replace',
          expectedVersion: 'sha256:stale',
        },
      })).resolves.toMatchObject({
        id: 'stale_config_write',
        error: {
          code: -32602,
          message: 'config version conflict: expected sha256:stale',
          data: { config_write_error_code: 'configVersionConflict' },
        },
      });
    });
  
  it('returns null AppServer config requirements when no managed layer exists', async () => {
      await expect(harness.appServerRpc('configRequirements/read', {})).resolves.toEqual({ requirements: null });
    });
  
  it('lists AppServer experimental features with upstream metadata and cursor pagination', async () => {
      const firstPage = await harness.appServerRpc('experimentalFeature/list', { limit: 2 });
      expect(firstPage).toMatchObject({
        data: [
          { name: 'undo', stage: 'removed', enabled: false, defaultEnabled: false },
          { name: 'shell_tool', stage: 'stable', enabled: true, defaultEnabled: true },
        ],
        nextCursor: '2',
      });
  
      const allFeatures = await harness.appServerRpc('experimentalFeature/list', {});
      expect(allFeatures.data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'memories',
          stage: 'beta',
          displayName: 'Memories',
          enabled: false,
          defaultEnabled: false,
        }),
        expect.objectContaining({
          name: 'apps',
          stage: 'stable',
          enabled: false,
          defaultEnabled: true,
        }),
        expect.objectContaining({
          name: 'prevent_idle_sleep',
          stage: 'beta',
          enabled: false,
          defaultEnabled: false,
        }),
      ]));
  
      await expect(harness.appServerRpcEnvelope({
        id: 'bad_feature_cursor',
        method: 'experimentalFeature/list',
        params: { cursor: 'nope' },
      })).resolves.toMatchObject({
        id: 'bad_feature_cursor',
        error: { code: -32600, message: 'invalid cursor: nope' },
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'missing_feature_thread',
        method: 'experimentalFeature/list',
        params: { threadId: 'missing-thread' },
      })).resolves.toMatchObject({
        id: 'missing_feature_thread',
        error: { code: -32600, message: 'thread not found: missing-thread' },
      });
    });
  
  it('lists only the default AppServer collaboration mode', async () => {
      await expect(harness.appServerRpc('collaborationMode/list', {})).resolves.toEqual({
        data: [
          {
            name: 'Default',
            mode: 'default',
            model: null,
            reasoning_effort: null,
          },
        ],
      });
    });
  
  it('rejects the removed AppServer Plan collaboration mode', async () => {
        const startedThread = await harness.appServerRpc('thread/start', { name: 'Default mode thread', cwd: process.cwd() });

        await expect(harness.appServerRpcEnvelope({
          id: 'removed_plan_mode',
          method: 'turn/start',
          params: {
          threadId: startedThread.thread.id,
          input: [{ type: 'text', text: 'Plan before editing.' }],
          collaborationMode: { mode: 'plan' },
          },
        })).resolves.toMatchObject({
          id: 'removed_plan_mode',
          error: { code: -32602, message: 'Plan mode is no longer supported' },
        });
    });
});
