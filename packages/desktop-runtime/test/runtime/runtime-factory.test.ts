import {
  OPENAI_IMAGE_GENERATION_TOOL_NAME,
  PUBLISH_ARTIFACT_TOOL_NAME,
  type DesktopResolveNetworkProxyInput,
} from '@setsuna-desktop/contracts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntimeFactory } from '../../src/runtime/runtime-factory.js';
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
      selected: true,
    }, context);

    expect(created.content).toContain('Skill configured: Factory Skill');
    await expect(runtime.skillRegistry.listSkills()).resolves.toMatchObject({
      skills: expect.arrayContaining([
        expect.objectContaining({
          id: 'factory-skill',
          name: 'Factory Skill',
          kind: 'user',
          enabled: true,
          selected: true,
        }),
      ]),
    });

    const updated = await runtime.skillRegistry.updateSkill('factory-skill', {
      name: 'Factory Skill Updated',
      content: '# Factory Skill Updated\n\nUpdated through the capability form registry.',
      selected: false,
    });

    expect(updated).toMatchObject({
      id: 'factory-skill',
      name: 'Factory Skill Updated',
      selected: false,
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

  it('routes image generation requests through the runtime network proxy adapter', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-image-proxy-test-'));
    const nativeBridge = new RejectingProxyBridge();
    const runtime = createRuntimeFactory({ dataDir, nativeBridge });

    try {
      await runtime.pluginStore.installPlugin({
        path: path.join(process.cwd(), 'plugins', 'openai-image-generation'),
      });
      await runtime.configStore.saveConfig({
        imageGeneration: {
          apiKey: 'image-secret',
          baseUrl: 'https://images.example.test/v1',
          model: 'gpt-image-1',
        },
      });

      await expect(runtime.imageGenerationToolHost.runTool(
        OPENAI_IMAGE_GENERATION_TOOL_NAME,
        { prompt: 'proxy wiring test' },
        { threadId: 'thread_1' },
      )).rejects.toThrow('proxy resolution reached');
      expect(nativeBridge.proxyInputs).toEqual([{
        scope: 'runtime',
        override: undefined,
      }]);
    } finally {
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
