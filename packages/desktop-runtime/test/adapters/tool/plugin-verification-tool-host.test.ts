import {
  parseRuntimePluginUiCardDeclarations,
  parseRuntimePluginUiManifest,
} from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  PluginVerificationToolHost,
  VERIFY_PLUGIN_TOOL,
} from '../../../src/adapters/tool/plugin-verification-tool-host.js';
import type { ExtensionRegisteredTool, ExtensionRuntime } from '../../../src/ports/extension-runtime.js';
import type { InstalledPluginRecord } from '../../../src/ports/plugin-bundle-store.js';

describe('plugin verification tool host', () => {
  it('runs real tool and UI action paths before declaring a Plugin usable', async () => {
    const plugin = weatherPlugin();
    const registeredTool = weatherTool();
    const extensions = verificationRuntime({
      listTools: vi.fn(async () => [registeredTool]),
      runTool: vi.fn(async () => ({
        content: '杭州 28°C',
        data: {
          resultKind: 'plugin.ui-card',
          resultMajor: 1,
          payload: { id: 'weather.current', pluginId: plugin.id },
        },
      })),
      runRendererUiAction: vi.fn(async () => ({ status: 'completed' as const })),
      readRendererUiData: vi.fn(async () => ({
        data: { summary: { label: '晴 · 28°C' } },
      })),
    });
    const host = new PluginVerificationToolHost(
      { listInstalledRecords: vi.fn(async () => [plugin]) },
      extensions,
    );
    const input = weatherVerificationInput();
    const context = {
      threadId: 'thread_1',
      projectId: 'project_1',
    };

    await expect(host.listTools({ threadId: 'thread_1', features: { plugins: false } })).resolves.toEqual([]);
    await expect(host.listTools(context)).resolves.toEqual([
      expect.objectContaining({ name: VERIFY_PLUGIN_TOOL }),
    ]);
    await expect(host.approvalForTool(VERIFY_PLUGIN_TOOL, input)).resolves.toMatchObject({
      reason: expect.stringContaining('实际执行 2 个扩展路径'),
      rejectWhenApprovalDisabled: true,
    });
    expect(host.toolRuntimeProfile(VERIFY_PLUGIN_TOOL)).toMatchObject({
      approvalMode: 'orchestrated',
      requiresSandboxBypassApproval: true,
    });

    await expect(host.runTool(VERIFY_PLUGIN_TOOL, input, context)).resolves.toMatchObject({
      content: expect.stringContaining('Verified and usable: true.'),
      data: {
        pluginId: 'hangzhou-weather',
        verified: true,
        checks: [
          expect.objectContaining({ kind: 'tool', name: 'get_weather', resultKind: 'plugin.ui-card' }),
          expect.objectContaining({ kind: 'ui-action', name: 'weather.refresh', statePaths: ['summary.label'] }),
        ],
      },
    });
    expect(extensions.runTool).toHaveBeenCalledWith(
      registeredTool.name,
      { city: '杭州' },
      context,
    );
    expect(extensions.runRendererUiAction).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'hangzhou-weather',
      actionId: 'weather.refresh',
      context: expect.objectContaining({
        contributionId: 'weather.page',
        surface: 'renderer.plugin.page',
        projectId: 'project_1',
      }),
    }), undefined);
  });

  it('fails a declared card tool that executes but does not return a UI card', async () => {
    const plugin = weatherPlugin();
    const extensions = verificationRuntime({
      listTools: vi.fn(async () => [weatherTool()]),
      runTool: vi.fn(async () => ({ content: 'plain text only' })),
    });
    const host = new PluginVerificationToolHost(
      { listInstalledRecords: vi.fn(async () => [plugin]) },
      extensions,
    );

    await expect(host.runTool(VERIFY_PLUGIN_TOOL, {
      pluginId: plugin.id,
      checks: [{
        kind: 'tool',
        name: 'get_weather',
        input: { city: '杭州' },
      }, {
        kind: 'ui-action',
        name: 'weather.refresh',
        contributionId: 'weather.page',
      }],
    }, { threadId: 'thread_1' })).rejects.toMatchObject({
      message: expect.stringContaining('Expected plugin.ui-card, received no structured result'),
      failureKind: 'plugin_verification_failed',
      failureStage: 'execution',
    });
  });

  it('fails when a UI action does not produce its declared view state', async () => {
    const plugin = weatherPlugin();
    const extensions = verificationRuntime({
      runRendererUiAction: vi.fn(async () => ({ status: 'completed' as const })),
      readRendererUiData: vi.fn(async () => ({ data: {} })),
    });
    const host = new PluginVerificationToolHost(
      { listInstalledRecords: vi.fn(async () => [plugin]) },
      extensions,
    );

    await expect(host.runTool(VERIFY_PLUGIN_TOOL, {
      pluginId: plugin.id,
      checks: [{
        kind: 'ui-action',
        name: 'weather.refresh',
        contributionId: 'weather.page',
        expectStatePaths: ['summary.label'],
      }, { kind: 'tool', name: 'get_weather', input: { city: '杭州' } }],
    }, { threadId: 'thread_1' })).rejects.toThrow('Expected state path was not written: summary.label');
  });

  it('does not satisfy state assertions through Object prototype properties', async () => {
    const plugin = weatherPlugin();
    const extensions = verificationRuntime({
      runRendererUiAction: vi.fn(async () => ({ status: 'completed' as const })),
      readRendererUiData: vi.fn(async () => ({ data: {} })),
    });
    const host = new PluginVerificationToolHost(
      { listInstalledRecords: vi.fn(async () => [plugin]) },
      extensions,
    );

    await expect(host.runTool(VERIFY_PLUGIN_TOOL, {
      pluginId: plugin.id,
      checks: [{
        kind: 'ui-action',
        name: 'weather.refresh',
        contributionId: 'weather.page',
        expectStatePaths: ['constructor'],
      }, { kind: 'tool', name: 'get_weather', input: { city: '杭州' } }],
    }, { threadId: 'thread_1' })).rejects.toThrow('Expected state path was not written: constructor');
  });

  it('rejects partial coverage before executing any Plugin path', async () => {
    const plugin = weatherPlugin();
    plugin.tools = [...(plugin.tools ?? []), { name: 'get_forecast', description: 'Get forecast.' }];
    const extensions = verificationRuntime({
      listTools: vi.fn(async () => [weatherTool()]),
    });
    const host = new PluginVerificationToolHost(
      { listInstalledRecords: vi.fn(async () => [plugin]) },
      extensions,
    );

    await expect(host.runTool(VERIFY_PLUGIN_TOOL, weatherVerificationInput(), {
      threadId: 'thread_1',
    })).rejects.toMatchObject({
      message: expect.stringContaining('Missing verification paths: tool get_forecast'),
      failureKind: 'plugin_verification_incomplete',
      failureStage: 'validation',
    });
    expect(extensions.runTool).not.toHaveBeenCalled();
    expect(extensions.runRendererUiAction).not.toHaveBeenCalled();
  });
});

function weatherPlugin(): InstalledPluginRecord {
  return {
    id: 'hangzhou-weather',
    name: '杭州天气',
    installedAt: '2026-09-01T00:00:00.000Z',
    installationSource: 'local',
    tools: [{ name: 'get_weather', description: 'Get weather.' }],
    skills: [],
    skillEntries: [],
    mcpServers: [],
    mcpServerInputs: [],
    hooks: [],
    hookCount: 0,
    resources: [],
    sourcePath: '/plugins/hangzhou-weather',
    installPath: '/runtime/plugins/hangzhou-weather',
    manifestPath: '/runtime/plugins/hangzhou-weather/.setsuna-plugin/plugin.json',
    extension: {
      apiVersion: 1,
      runtime: 'node-worker',
      entry: 'extension/entry.mjs',
      capabilities: ['tools', 'ui', 'state', 'network'],
      bundleHash: 'bundle-hash',
      trustedHash: 'bundle-hash',
      uiCards: parseRuntimePluginUiCardDeclarations([{
        id: 'weather.current',
        label: 'Weather',
        toolName: 'get_weather',
        preview: { html: '<main>28°C</main>' },
      }]),
      rendererUi: parseRuntimePluginUiManifest({
        schemaVersion: 2,
        actions: [{ id: 'weather.refresh', approval: { message: 'Refresh weather?' } }],
        contributions: [{
          id: 'weather.page',
          slot: 'renderer.plugin.page',
          navigation: { label: 'Weather' },
          data: { stateKey: 'weather.view', scope: 'global' },
          tree: { type: 'button', actionId: 'weather.refresh', label: 'Refresh' },
        }],
      }),
    },
  };
}

function weatherTool(): ExtensionRegisteredTool {
  return {
    name: 'extension__hangzhou_weather__get_weather',
    localName: 'get_weather',
    description: 'Get weather.',
    inputSchema: { type: 'object' },
    plugin: { id: 'hangzhou-weather', name: '杭州天气' },
    execution: {
      supportsParallel: false,
      requiresApproval: true,
      requiresSandboxBypassApproval: true,
    },
  };
}

function verificationRuntime(
  overrides: Partial<Pick<
    ExtensionRuntime,
    'listTools' | 'readRendererUiData' | 'runRendererUiAction' | 'runTool'
  >>,
): Pick<ExtensionRuntime, 'listTools' | 'readRendererUiData' | 'runRendererUiAction' | 'runTool'> {
  return {
    listTools: vi.fn(async () => []),
    runTool: vi.fn(async () => ({ content: 'ok' })),
    runRendererUiAction: vi.fn(async () => ({ status: 'completed' as const })),
    readRendererUiData: vi.fn(async () => ({ data: {} })),
    ...overrides,
  };
}

function weatherVerificationInput() {
  return {
    pluginId: 'hangzhou-weather',
    checks: [{
      kind: 'tool',
      name: 'get_weather',
      input: { city: '杭州' },
    }, {
      kind: 'ui-action',
      name: 'weather.refresh',
      contributionId: 'weather.page',
      payload: { city: '杭州' },
      expectStatePaths: ['summary.label'],
    }],
  };
}
