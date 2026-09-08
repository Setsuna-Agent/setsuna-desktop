import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PluginBundleToolHost } from '../../../src/adapters/tool/plugin-bundle-tool-host.js';
import {
  configurePluginRendererUiSchema,
  normalizeConfigurePluginInput,
} from '../../../src/adapters/tool/configure-plugin-tool.js';
import type { InstalledPluginRecord, PluginBundleStore } from '../../../src/ports/plugin-bundle-store.js';
import type { PluginDraftStore } from '../../../src/ports/plugin-draft-store.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('plugin bundle tool host', () => {
  it('advertises scoped Renderer UI data and normalizes the former top-level shorthand', () => {
    expect(configurePluginRendererUiSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        contributions: {
          items: {
            additionalProperties: false,
            properties: {
              data: { required: ['stateKey', 'scope'] },
              slot: {
                enum: expect.arrayContaining(['renderer.capabilities.plugin.details']),
              },
            },
          },
        },
      },
    });

    const normalized = normalizeConfigurePluginInput({
      manifest: {
        id: 'release-checker',
        name: 'Release Checker',
        extension: {
          apiVersion: 1,
          runtime: 'node-worker',
          entry: 'extension/entry.mjs',
          capabilities: ['ui', 'state'],
          rendererUi: {
            schemaVersion: 2,
            actions: [],
            contributions: [{
              id: 'release.page',
              slot: 'renderer.plugin.page',
              stateKey: 'release.view',
              scope: 'project',
              navigation: { label: 'Release Checker' },
              tree: { type: 'text', text: 'Not run' },
            }],
          },
        },
      },
      files: [{ path: 'extension/entry.mjs', content: 'export default function activate() {}\n' }],
    });

    expect(normalized.manifest).toMatchObject({
      extension: {
        rendererUi: {
          contributions: [{
            data: { scope: 'project', stateKey: 'release.view' },
          }],
        },
      },
    });
    const extension = normalized.manifest.extension as {
      rendererUi: { contributions: Array<Record<string, unknown>> };
    };
    expect(extension.rendererUi.contributions[0]).not.toHaveProperty('stateKey');
    expect(extension.rendererUi.contributions[0]).not.toHaveProperty('scope');
  });

  it('normalizes misplaced UI cards but rejects other fields outside the tool schema', () => {
    const normalized = normalizeConfigurePluginInput({
      manifest: {
        id: 'weather-card',
        name: 'Weather Card',
        tools: [{ name: 'get_weather' }],
        extension: {
          apiVersion: 1,
          runtime: 'node-worker',
          entry: 'extension/entry.mjs',
          capabilities: ['tools', 'ui'],
        },
        uiCards: [{
          id: 'weather.current',
          label: 'Current weather',
          toolName: 'get_weather',
          preview: { html: '<main>28°C</main>' },
        }],
      },
      files: [{ path: 'extension/entry.mjs', content: 'export default function activate() {}\n' }],
    });

    expect(normalized.manifest).not.toHaveProperty('uiCards');
    expect(normalized.manifest).toMatchObject({
      extension: { uiCards: [{ id: 'weather.current', toolName: 'get_weather' }] },
    });
    expect(() => normalizeConfigurePluginInput({
      manifest: { id: 'unknown-field', name: 'Unknown Field', surprise: true },
      files: [],
    })).toThrow('configure_plugin.manifest contains unsupported field: surprise');
  });

  it('gates plugin tools by feature and requires approval for capability mutations', async () => {
    const store = pluginStoreFixture();
    const host = new PluginBundleToolHost(store, pluginDraftStoreFixture());

    await expect(host.listTools({ threadId: 'thread_1', features: { plugins: false } })).resolves.toEqual([]);
    await expect(host.listTools({ threadId: 'thread_1', features: { plugins: true } })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'install_plugin_bundle' }),
        expect.objectContaining({ name: 'configure_plugin' }),
        expect.objectContaining({ name: 'remove_plugin_bundle' }),
        expect.objectContaining({ name: 'list_plugin_resources' }),
        expect.objectContaining({ name: 'read_plugin_resource' }),
      ]),
    );
    await expect(host.approvalForTool('install_plugin_bundle', { path: '/tmp/demo' })).resolves.toMatchObject({
      reason: expect.stringContaining('添加 Skill、MCP、Hook 和资源'),
    });
    await expect(host.approvalForTool('remove_plugin_bundle', { pluginId: 'demo' })).resolves.toMatchObject({
      reason: expect.stringContaining('移除它拥有的'),
    });

    await host.runTool('install_plugin_bundle', { path: '/tmp/demo' }, { threadId: 'thread_1' });
    expect(store.installPlugin).toHaveBeenCalledWith({ path: '/tmp/demo' });
    await host.runTool('remove_plugin_bundle', { pluginId: 'demo' }, { threadId: 'thread_1' });
    expect(store.removePlugin).toHaveBeenCalledWith('demo');
  });

  it('marks resource text as external context and only attaches images for vision models', async () => {
    const store = pluginStoreFixture();
    const host = new PluginBundleToolHost(store, pluginDraftStoreFixture());

    const list = await host.runTool('list_plugin_resources', {}, { threadId: 'thread_1' });
    expect(list).toMatchObject({
      containsExternalContext: true,
      data: { resources: [expect.objectContaining({ pluginId: 'demo', id: 'guide' })] },
    });

    const textResult = await host.runTool('read_plugin_resource', {
      pluginId: 'demo',
      resourceId: 'guide',
    }, { threadId: 'thread_1' });
    expect(textResult).toMatchObject({ content: '# Guide', containsExternalContext: true });

    const imageResult = await host.runTool('read_plugin_resource', {
      pluginId: 'demo',
      resourceId: 'logo',
    }, {
      threadId: 'thread_1',
      toolCallId: 'call/1',
      modelCapabilities: { supportsImages: true },
    });
    expect(imageResult).toMatchObject({
      containsExternalContext: true,
      attachments: [{
        id: 'plugin_resource_demo_logo_call_1',
        name: 'logo.png',
        type: 'image/png',
        url: `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`,
      }],
      data: { pluginId: 'demo', resourceId: 'logo', mimeType: 'image/png' },
    });
    expect(JSON.stringify(imageResult.data)).not.toContain(ONE_PIXEL_PNG.toString('base64'));

    const noVisionResult = await host.runTool('read_plugin_resource', {
      pluginId: 'demo',
      resourceId: 'logo',
    }, { threadId: 'thread_1', modelCapabilities: { supportsImages: false } });
    expect(noVisionResult.attachments).toBeUndefined();
    expect(noVisionResult.content).toContain('does not support image input');
  });

  it('creates an approved managed bundle, trusts its exact executable hash, and updates only its own source', async () => {
    const store = pluginStoreFixture();
    const drafts = pluginDraftStoreFixture();
    const host = new PluginBundleToolHost(store, drafts);
    const input = configurePluginInput('export default function activate() {}\n');
    const approval = await host.approvalForTool('configure_plugin', input);
    const preview = await host.previewToolCall('configure_plugin', input, { threadId: 'thread_1' });

    expect(approval).toMatchObject({
      reason: expect.stringContaining('包含可执行扩展或 Hook'),
      argumentsPreview: expect.stringContaining('extension/entry.mjs'),
    });
    expect(preview).toMatchObject({
      integrityToken: expect.stringMatching(/^configure-plugin:/u),
      resultPreview: expect.stringContaining('"action":"create"'),
    });

    const created = await host.runTool('configure_plugin', input, {
      threadId: 'thread_1',
      expectedPreviewIntegrityToken: preview?.integrityToken,
    });
    expect(drafts.writeDraft).toHaveBeenCalledWith(expect.objectContaining({ pluginId: 'demo' }));
    expect(store.installPlugin).toHaveBeenCalledWith(
      { path: '/managed/plugin-drafts/demo' },
      { trustHooks: true, trustExtension: true },
    );
    expect(created).toMatchObject({ data: { action: 'create', plugin: { id: 'demo' } } });

    vi.mocked(store.listInstalledRecords).mockResolvedValue([installedRecordFixture('/managed/plugin-drafts/demo')]);
    const updatePreview = await host.previewToolCall('configure_plugin', input, { threadId: 'thread_1' });
    expect(updatePreview?.resultPreview).toContain('"action":"update"');
    await host.runTool('configure_plugin', input, {
      threadId: 'thread_1',
      expectedPreviewIntegrityToken: updatePreview?.integrityToken,
    });
    expect(store.updatePlugin).toHaveBeenCalledWith(
      { path: '/managed/plugin-drafts/demo' },
      { trustHooks: true, trustExtension: true },
    );

    vi.mocked(store.listInstalledRecords).mockResolvedValue([installedRecordFixture('/bundled/plugins/demo')]);
    await expect(host.approvalForTool('configure_plugin', input)).rejects.toThrow('installed from another source');
  });

  it('requests functional verification only when the installed extension exposes a verifiable path', async () => {
    const store = pluginStoreFixture();
    const installPlugin = vi.mocked(store.installPlugin);
    installPlugin
      .mockResolvedValueOnce(pluginInstallResult(pluginSummaryFixture({
        extension: {
          apiVersion: 1,
          runtime: 'node-worker',
          capabilities: ['events'],
          trust: 'trusted',
        },
      })))
      .mockResolvedValueOnce(pluginInstallResult(pluginSummaryFixture({
        extension: {
          apiVersion: 1,
          runtime: 'node-worker',
          capabilities: ['ui'],
          rendererUi: {
            schemaVersion: 2,
            actions: [],
            contributions: [{
              id: 'status.page',
              slot: 'renderer.plugin.page',
              navigation: { label: 'Status' },
              tree: { type: 'text', text: 'Ready' },
            }],
          },
          trust: 'trusted',
        },
      })))
      .mockResolvedValueOnce(pluginInstallResult(pluginSummaryFixture({
        tools: [{ name: 'echo' }],
        extension: {
          apiVersion: 1,
          runtime: 'node-worker',
          capabilities: ['tools'],
          trust: 'trusted',
        },
      })));
    const host = new PluginBundleToolHost(store, pluginDraftStoreFixture());
    const input = configurePluginInput('export default function activate() {}\n');

    const eventsOnly = await host.runTool('configure_plugin', input, { threadId: 'thread_1' });
    expect(eventsOnly).toMatchObject({ data: { verification: { required: false } } });
    expect(eventsOnly.content).not.toContain('Functional verification: pending');

    const readOnlyPage = await host.runTool('configure_plugin', input, { threadId: 'thread_1' });
    expect(readOnlyPage).toMatchObject({ data: { verification: { required: false } } });

    const withTool = await host.runTool('configure_plugin', input, { threadId: 'thread_1' });
    expect(withTool).toMatchObject({
      data: { verification: { required: true, tool: 'verify_plugin' } },
    });
    expect(withTool.content).toContain('Functional verification: pending');
  });

  it('binds configure_plugin execution to the exact approved bundle contents', async () => {
    const store = pluginStoreFixture();
    const drafts = pluginDraftStoreFixture();
    const host = new PluginBundleToolHost(store, drafts);

    await expect(host.runTool('configure_plugin', configurePluginInput('export default function activate() { /* changed */ }\n'), {
      threadId: 'thread_1',
      expectedPreviewIntegrityToken: 'configure-plugin:stale',
    })).rejects.toMatchObject({ failureKind: 'preview_changed', failureStage: 'preflight' });
    expect(drafts.writeDraft).not.toHaveBeenCalled();
  });

  it('rejects invalid extension JavaScript before requesting approval', async () => {
    const store = pluginStoreFixture();
    const host = new PluginBundleToolHost(store, pluginDraftStoreFixture());

    await expect(host.approvalForTool(
      'configure_plugin',
      configurePluginInput('export default function activate() { const view = <div class="broken">; }\n'),
    )).rejects.toThrow(/extension\/entry\.mjs is not valid JavaScript[\s\S]*Unexpected token/u);
    expect(store.listInstalledRecords).not.toHaveBeenCalled();
  });

  it('rejects an incomplete complete snapshot before approval and reports all missing plugin files', async () => {
    const store = pluginStoreFixture();
    const host = new PluginBundleToolHost(store, pluginDraftStoreFixture());
    const approval = host.approvalForTool('configure_plugin', {
      manifest: {
        id: 'hangzhou-weather',
        name: '杭州天气',
        resources: [
          { id: 'weather-html', path: 'ui/weather.html' },
          { id: 'weather-css', path: 'ui/weather.css' },
          { id: 'weather-js', path: 'ui/weather.js' },
        ],
        extension: {
          apiVersion: 1,
          entry: 'extension/entry.mjs',
          capabilities: ['ui', 'state', 'network'],
          network: { allowedOrigins: ['https://api.open-meteo.com'] },
          rendererUi: {
            schemaVersion: 2,
            actions: [{ id: 'weather.refresh', approval: { message: '联网刷新天气吗？' } }],
            contributions: [{
              id: 'weather.page',
              slot: 'renderer.plugin.page',
              navigation: { label: '天气' },
              data: { stateKey: 'weather.view', scope: 'global' },
              document: {
                htmlResourceId: 'weather-html',
                cssResourceId: 'weather-css',
                jsResourceId: 'weather-js',
                actionIds: ['weather.refresh'],
              },
            }],
          },
        },
      },
      files: [{ path: 'ui/weather.html', content: '<main id="weather"></main>' }],
    });

    await expect(approval).rejects.toThrow(
      /ui\/weather\.css[\s\S]*ui\/weather\.js[\s\S]*runtime must be "node-worker"[\s\S]*extension\/entry\.mjs/u,
    );
    expect(store.listInstalledRecords).not.toHaveBeenCalled();
  });

  it('requires manifest references to match canonical draft paths exactly', () => {
    expect(() => normalizeConfigurePluginInput({
      manifest: {
        id: 'case-sensitive-entry',
        name: 'Case-sensitive entry',
        extension: {
          apiVersion: 1,
          runtime: 'node-worker',
          entry: 'extension/Entry.mjs',
          capabilities: ['tools'],
        },
      },
      files: [{ path: 'extension/entry.mjs', content: 'export default function activate() {}\n' }],
    })).toThrow('files is missing manifest.extension.entry: extension/Entry.mjs');

    if (path.sep === '/') {
      expect(() => normalizeConfigurePluginInput({
        manifest: {
          id: 'backslash-entry',
          name: 'Backslash entry',
          extension: {
            apiVersion: 1,
            runtime: 'node-worker',
            entry: 'extension\\entry.mjs',
            capabilities: ['tools'],
          },
        },
        files: [{ path: 'extension/entry.mjs', content: 'export default function activate() {}\n' }],
      })).toThrow('files is missing manifest.extension.entry: extension\\entry.mjs');
    }
  });

  it('recognizes an AI-managed draft through a symlinked runtime data root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-draft-link-'));
    try {
      const realDraftRoot = path.join(root, 'real-drafts');
      const linkedDraftRoot = path.join(root, 'linked-drafts');
      await mkdir(path.join(realDraftRoot, 'demo'), { recursive: true });
      await symlink(realDraftRoot, linkedDraftRoot, process.platform === 'win32' ? 'junction' : 'dir');

      const store = pluginStoreFixture();
      const canonicalSource = await realpath(path.join(linkedDraftRoot, 'demo'));
      vi.mocked(store.listInstalledRecords).mockResolvedValue([installedRecordFixture(canonicalSource)]);
      const drafts: PluginDraftStore = {
        pathFor: (pluginId) => path.join(linkedDraftRoot, pluginId),
        writeDraft: vi.fn(async (input) => ({ pluginId: input.pluginId, path: path.join(linkedDraftRoot, input.pluginId) })),
      };
      const host = new PluginBundleToolHost(store, drafts);

      await expect(host.approvalForTool(
        'configure_plugin',
        configurePluginInput('export default function activate() {}\n'),
      )).resolves.toMatchObject({ reason: expect.any(String) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function pluginStoreFixture(): PluginBundleStore {
  return {
    catalogRevision: vi.fn(async () => 'catalog-1'),
    listPlugins: vi.fn(async () => ({
      plugins: [{
        id: 'demo',
        name: 'Demo',
        installedAt: '2026-07-15T00:00:00.000Z',
        skills: [],
        mcpServers: [],
        hooks: [],
        hookCount: 0,
        resources: [{ id: 'guide', label: 'Guide', path: 'guide.md', size: 7 }],
      }],
    })),
    inspectPlugin: vi.fn(async () => ({
      id: 'demo',
      name: 'Demo',
      tags: [],
      featured: false,
      skills: [],
      mcpServers: [],
      hooks: [],
      resources: [],
      capabilities: { skills: 0, mcpServers: 0, hooks: 0, resources: 0 },
      sourcePath: '/tmp/demo',
    })),
    migrateLegacyMarketplaceInstallations: vi.fn(async () => undefined),
    installPlugin: vi.fn(async () => ({
      plugin: {
        id: 'demo',
        name: 'Demo',
        installedAt: '2026-07-15T00:00:00.000Z',
        skills: [],
        mcpServers: [],
        hooks: [],
        hookCount: 0,
        resources: [],
      },
      installedMcpServers: [],
      reusedMcpServers: [],
    })),
    updatePlugin: vi.fn(async () => ({
      plugin: {
        id: 'demo',
        name: 'Demo',
        installedAt: '2026-07-15T00:00:00.000Z',
        skills: [],
        mcpServers: [],
        hooks: [],
        hookCount: 0,
        resources: [],
      },
      installedMcpServers: [],
      reusedMcpServers: [],
    })),
    removePlugin: vi.fn(async () => ({ pluginId: 'demo', removedMcpServers: [], preservedMcpServers: [] })),
    setExtensionTrust: vi.fn(async () => ({ plugins: [] })),
    listInstalledRecords: vi.fn(async () => []),
    readItemContent: vi.fn(async (pluginId, kind, itemId) => ({ pluginId, kind, itemId, files: [] })),
    readBundleItemContent: vi.fn(async (_input, kind, itemId) => ({ pluginId: 'demo', kind, itemId, files: [] })),
    readTrustedRendererUiDocument: vi.fn(async () => ({
      revision: 'trusted-hash',
      html: '',
      css: '',
      js: '',
    })),
    readResource: vi.fn(async (_pluginId, resourceId) => resourceId === 'logo'
      ? {
          pluginId: 'demo',
          resourceId: 'logo',
          label: 'Logo',
          path: 'resources/logo.png',
          size: ONE_PIXEL_PNG.byteLength,
          mimeType: 'image/png',
          base64: ONE_PIXEL_PNG.toString('base64'),
        }
      : {
          pluginId: 'demo',
          resourceId: 'guide',
          label: 'Guide',
          path: 'resources/guide.md',
          size: 7,
          mimeType: 'text/markdown',
          text: '# Guide',
        }),
  };
}

function pluginDraftStoreFixture(): PluginDraftStore {
  return {
    pathFor: vi.fn((pluginId) => `/managed/plugin-drafts/${pluginId}`),
    writeDraft: vi.fn(async (input) => ({ pluginId: input.pluginId, path: `/managed/plugin-drafts/${input.pluginId}` })),
  };
}

function pluginSummaryFixture(patch: Partial<RuntimePluginSummary> = {}): RuntimePluginSummary {
  return {
    id: 'demo',
    name: 'Demo',
    installedAt: '2026-07-15T00:00:00.000Z',
    skills: [],
    mcpServers: [],
    hooks: [],
    hookCount: 0,
    resources: [],
    ...patch,
  };
}

function pluginInstallResult(plugin: RuntimePluginSummary) {
  return { plugin, installedMcpServers: [], reusedMcpServers: [] };
}

function configurePluginInput(code: string) {
  return {
    manifest: {
      schemaVersion: 2,
      id: 'demo',
      name: 'Demo Plugin',
      extension: {
        apiVersion: 1,
        runtime: 'node-worker',
        entry: 'extension/entry.mjs',
        capabilities: ['tools'],
      },
    },
    files: [{ path: 'extension/entry.mjs', content: code }],
  };
}

function installedRecordFixture(sourcePath: string): InstalledPluginRecord {
  return {
    id: 'demo',
    name: 'Demo',
    installedAt: '2026-07-15T00:00:00.000Z',
    sourcePath,
    installPath: '/runtime/plugins/demo',
    manifestPath: '/runtime/plugins/demo/.setsuna-plugin/plugin.json',
    skills: [],
    skillEntries: [],
    mcpServers: [],
    mcpServerInputs: [],
    hooks: [],
    hookCount: 0,
    resources: [],
  };
}
