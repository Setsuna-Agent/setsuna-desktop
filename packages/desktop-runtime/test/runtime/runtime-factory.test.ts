import {
  OPENAI_IMAGE_GENERATION_PLUGIN_ID,
  OPENAI_IMAGE_GENERATION_TOOL_NAME,
  OPENAI_VISION_RECOGNITION_PLUGIN_ID,
  OPENAI_VISION_RECOGNITION_TOOL_NAME,
  PUBLISH_ARTIFACT_TOOL_NAME,
  WEB_SEARCH_PLUGIN_ID,
  WEB_SEARCH_TOOL_NAME,
  type DesktopResolveNetworkProxyInput,
} from '@setsuna-desktop/contracts';
import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { imageGenerationSettings } from '@setsuna-desktop/feature-image-generation/contracts';
import { visionRecognitionServiceCapability } from '@setsuna-desktop/feature-vision-recognition/contracts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRuntimeFactory } from '../../src/runtime/runtime-factory.js';
import { activateBuiltinRuntimeFeatures } from '../../src/composition/runtime-feature-composition.js';
import { InMemoryDesktopNativeBridge } from '../support/in-memory-secret-store.js';

describe('runtime factory tool wiring', () => {
  it('uses the same skill registry for chat tool creation and capability form APIs', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-factory-test-'));
    const runtime = createRuntimeFactory({ dataDir });
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    const tools = await runtime.toolHost.listTools(context);
    expect(tools.filter((tool) => tool.name === 'configure_skill')).toHaveLength(1);
    expect(tools.filter((tool) => tool.name === 'open_browser')).toHaveLength(1);
    expect(tools.filter((tool) => tool.name === 'request_user_input')).toHaveLength(1);
    expect(tools.filter((tool) => tool.name === PUBLISH_ARTIFACT_TOOL_NAME)).toHaveLength(1);
    const systemPrompt = await runtime.toolHost.systemPrompt?.(context, { tools });
    expect(systemPrompt).toContain('call publish_artifact once');
    expect(systemPrompt).toContain('Use python3 or uv directly');
    await expect(runtime.toolHost.toolRuntimeProfile?.('request_user_input', context)).resolves.toMatchObject({
      approvalMode: 'selfManaged',
      supportsParallel: false,
    });

    await expect(runtime.toolHost.runTool('open_browser', { url: 'https://www.baidu.com' }, context)).resolves.toMatchObject({
      data: { kind: 'browser.open', url: 'https://www.baidu.com/' },
    });

    const created = await runtime.toolHost.runTool('configure_skill', {
      name: 'Factory Skill',
      description: 'Created through the chat Skill tool.',
      content: '# Factory Skill\n\nUse this from the shared runtime registry.',
    }, context);

    expect(created.content).toContain('Skill configured: Factory Skill');
    await expect(runtime.skillRegistry.listSkills()).resolves.toMatchObject({
      skills: expect.arrayContaining([
        expect.objectContaining({
          id: 'factory-skill',
          name: 'Factory Skill',
          kind: 'user',
          enabled: true,
        }),
      ]),
    });

    const updated = await runtime.skillRegistry.updateSkill('factory-skill', {
      name: 'Factory Skill Updated',
      content: '# Factory Skill Updated\n\nUpdated through the capability form registry.',
    });

    expect(updated).toMatchObject({
      id: 'factory-skill',
      name: 'Factory Skill Updated',
      content: expect.stringContaining('capability form registry'),
    });
    await expect(runtime.toolHost.previewToolCall?.('configure_skill', {
      id: 'factory-skill',
      name: 'Factory Skill Updated',
      content: '# Factory Skill Updated\n\nPreview existing skill.',
    }, context)).resolves.toMatchObject({
      resultPreview: expect.stringContaining('"action":"update"'),
    });
  });

  it('creates and updates a managed local Plugin through the chat tool', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-plugin-tool-test-'));
    const runtime = createRuntimeFactory({ dataDir });
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const input = {
      manifest: {
        id: 'factory-plugin',
        name: 'Factory Plugin',
        description: 'Created through configure_plugin.',
        extension: {
          apiVersion: 1,
          runtime: 'node-worker',
          entry: 'extension/entry.mjs',
          capabilities: ['state'],
        },
      },
      files: [{
        path: 'extension/entry.mjs',
        content: 'export default function activate() {}\n',
      }],
    };

    try {
      await expect(runtime.toolHost.listTools(context)).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'configure_plugin' })]),
      );
      await expect(runtime.toolHost.approvalForTool?.('configure_plugin', input, context)).resolves.toMatchObject({
        reason: expect.stringContaining('授权当前完整包哈希'),
      });
      const createPreview = await runtime.toolHost.previewToolCall?.('configure_plugin', input, context);
      const created = await runtime.toolHost.runTool('configure_plugin', input, {
        ...context,
        expectedPreviewIntegrityToken: createPreview?.integrityToken,
      });

      expect(created).toMatchObject({ data: { action: 'create', plugin: { id: 'factory-plugin' } } });
      await expect(runtime.pluginStore.listPlugins()).resolves.toMatchObject({
        plugins: [expect.objectContaining({
          id: 'factory-plugin',
          extension: expect.objectContaining({ trust: 'trusted' }),
        })],
      });

      const updateInput = {
        ...input,
        manifest: { ...input.manifest, version: '1.0.1', description: 'Updated through configure_plugin.' },
        files: [{ ...input.files[0], content: 'export default function activate() { /* updated */ }\n' }],
      };
      const updatePreview = await runtime.toolHost.previewToolCall?.('configure_plugin', updateInput, context);
      expect(updatePreview?.resultPreview).toContain('"action":"update"');
      await runtime.toolHost.runTool('configure_plugin', updateInput, {
        ...context,
        expectedPreviewIntegrityToken: updatePreview?.integrityToken,
      });
      await expect(runtime.pluginStore.listPlugins()).resolves.toMatchObject({
        plugins: [expect.objectContaining({
          id: 'factory-plugin',
          version: '1.0.1',
          description: 'Updated through configure_plugin.',
          extension: expect.objectContaining({ trust: 'trusted' }),
        })],
      });
    } finally {
      await runtime.extensionManager.shutdown();
      await runtime.mcpConnections.shutdown();
      await runtime.networkProxyFetch.close();
      await runtime.nativeBridge.close();
      await runtime.threadStore.close();
    }
  });

  it('routes image generation requests through the runtime network proxy adapter', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-image-proxy-test-'));
    const nativeBridge = new RejectingProxyBridge();
    const runtime = createRuntimeFactory({
      dataDir,
      nativeBridge,
      extensionWorkerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
      extensionWorkerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
    });
    const composition = await activateBuiltinRuntimeFeatures(runtime);

    try {
      await runtime.pluginMarketplace.installPlugin(OPENAI_IMAGE_GENERATION_PLUGIN_ID);
      await runtime.featureSettings.updatePublicDocument({
        featureId: imageGenerationSettings.documents.connection.featureId,
        documentId: imageGenerationSettings.documents.connection.documentId,
        expectedRevision: 1,
        patch: {
          baseUrl: 'https://images.example.test/v1',
          model: 'gpt-image-1',
        },
        secretPatch: { apiKey: 'image-secret' },
      });

      await expect(runtime.toolHost.runTool(
        OPENAI_IMAGE_GENERATION_TOOL_NAME,
        { prompt: 'proxy wiring test' },
        { threadId: 'thread_1' },
      )).rejects.toThrow('proxy resolution reached');
      expect(nativeBridge.proxyInputs).toEqual([{
        scope: 'runtime',
        override: undefined,
      }]);
    } finally {
      await composition.dispose();
      await runtime.extensionManager.shutdown();
      await runtime.networkProxyFetch.close();
      await runtime.nativeBridge.close();
      await runtime.threadStore.close();
    }
  });

  it('adds and removes vision recognition with the marketplace plugin lifecycle', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-vision-plugin-test-'));
    const runtime = createRuntimeFactory({
      dataDir,
      extensionWorkerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
      extensionWorkerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
    });
    const composition = await activateBuiltinRuntimeFeatures(runtime);

    try {
      await expect(runtime.toolHost.listTools({ threadId: 'thread_1' })).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: OPENAI_VISION_RECOGNITION_TOOL_NAME })]),
      );
      await runtime.pluginMarketplace.installPlugin(OPENAI_VISION_RECOGNITION_PLUGIN_ID);
      await runtime.configStore.saveConfig({
        providers: [{
          id: 'vision-provider',
          name: 'Vision provider',
          provider: 'openai-compatible',
          apiKey: 'vision-secret',
          baseUrl: 'https://vision.example.test/v1',
          enabled: true,
          models: [{
            id: 'vision-model',
            name: 'Qwen Vision',
            code: 'qwen-vl-max',
            enabled: true,
            maxOutputTokens: 8_192,
            thinkingEnabled: false,
            thinkingEfforts: [],
            supportsImages: true,
          }],
        }],
      });
      const service = composition.resolveHostDependencies({
        vision: requiredCapability(visionRecognitionServiceCapability),
      }).vision;
      const settings = await service.readSettings();
      await service.updateSettings({
        expectedRevision: settings.revision,
        selection: { providerId: 'vision-provider', modelId: 'vision-model' },
      });

      await expect(runtime.toolHost.listTools({ threadId: 'thread_1' })).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: OPENAI_VISION_RECOGNITION_TOOL_NAME })]),
      );
      await runtime.pluginStore.removePlugin(OPENAI_VISION_RECOGNITION_PLUGIN_ID);
      await expect(runtime.toolHost.listTools({ threadId: 'thread_1' })).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: OPENAI_VISION_RECOGNITION_TOOL_NAME })]),
      );
    } finally {
      await composition.dispose();
      await runtime.extensionManager.shutdown();
      await runtime.networkProxyFetch.close();
      await runtime.nativeBridge.close();
      await runtime.threadStore.close();
    }
  });

  it('adds keyless web search through the marketplace and routes it through the runtime proxy', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-web-search-test-'));
    const nativeBridge = new RejectingProxyBridge();
    const runtime = createRuntimeFactory({
      dataDir,
      nativeBridge,
      extensionWorkerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
      extensionWorkerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
    });

    try {
      await expect(runtime.toolHost.listTools({ threadId: 'thread_1' })).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: WEB_SEARCH_TOOL_NAME })]),
      );
      await runtime.pluginMarketplace.installPlugin(WEB_SEARCH_PLUGIN_ID);
      await expect(runtime.toolHost.listTools({ threadId: 'thread_1' })).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: WEB_SEARCH_TOOL_NAME })]),
      );
      await expect(runtime.toolHost.runTool(
        WEB_SEARCH_TOOL_NAME,
        { query: 'proxy wiring test' },
        { threadId: 'thread_1' },
      )).rejects.toThrow('proxy resolution reached');
      expect(nativeBridge.proxyInputs).toEqual([{
        scope: 'runtime',
        override: undefined,
      }]);

      await runtime.pluginStore.removePlugin(WEB_SEARCH_PLUGIN_ID);
      await expect(runtime.toolHost.listTools({ threadId: 'thread_1' })).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: WEB_SEARCH_TOOL_NAME })]),
      );
    } finally {
      await runtime.extensionManager.shutdown();
      await runtime.networkProxyFetch.close();
      await runtime.nativeBridge.close();
      await runtime.threadStore.close();
    }
  });

  it('routes streamable HTTP MCP requests through the runtime network proxy adapter', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-mcp-proxy-test-'));
    const nativeBridge = new RejectingProxyBridge();
    const runtime = createRuntimeFactory({ dataDir, nativeBridge });

    try {
      await expect(runtime.mcpConnections.listTools({
        key: 'remote-docs',
        transport: 'streamableHttp',
        url: 'https://mcp.example.test/api',
      }, { scopeId: 'thread:proxy-test' })).rejects.toThrow('proxy resolution reached');
      expect(nativeBridge.proxyInputs).toEqual([{
        scope: 'runtime',
        override: undefined,
      }]);
    } finally {
      await runtime.mcpConnections.shutdown();
      await runtime.networkProxyFetch.close();
      await runtime.nativeBridge.close();
      await runtime.threadStore.close();
    }
  });

  it('routes stdio MCP process environments through the runtime network proxy adapter', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-stdio-mcp-proxy-test-'));
    const nativeBridge = new RejectingProxyBridge();
    const runtime = createRuntimeFactory({ dataDir, nativeBridge });

    try {
      await expect(runtime.mcpConnections.listTools({
        key: 'local-docs',
        transport: 'stdio',
        command: process.execPath,
      }, { scopeId: 'thread:stdio-proxy-test' })).rejects.toThrow('proxy resolution reached');
      expect(nativeBridge.proxyInputs).toEqual([{
        scope: 'runtime',
        override: undefined,
      }]);
    } finally {
      await runtime.mcpConnections.shutdown();
      await runtime.networkProxyFetch.close();
      await runtime.nativeBridge.close();
      await runtime.threadStore.close();
    }
  });
});

class RejectingProxyBridge extends InMemoryDesktopNativeBridge {
  readonly proxyInputs: DesktopResolveNetworkProxyInput[] = [];

  override async resolveNetworkProxy(input: DesktopResolveNetworkProxyInput): Promise<never> {
    this.proxyInputs.push(input);
    throw new Error('proxy resolution reached');
  }
}
