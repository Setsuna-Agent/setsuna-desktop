import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PluginBundleToolHost } from '../../../src/adapters/tool/plugin-bundle-tool-host.js';
import type { InstalledPluginRecord, PluginBundleStore } from '../../../src/ports/plugin-bundle-store.js';
import type { PluginDraftStore } from '../../../src/ports/plugin-draft-store.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('plugin bundle tool host', () => {
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

  it('binds configure_plugin execution to the exact approved bundle contents', async () => {
    const store = pluginStoreFixture();
    const drafts = pluginDraftStoreFixture();
    const host = new PluginBundleToolHost(store, drafts);

    await expect(host.runTool('configure_plugin', configurePluginInput('changed code\n'), {
      threadId: 'thread_1',
      expectedPreviewIntegrityToken: 'configure-plugin:stale',
    })).rejects.toMatchObject({ failureKind: 'preview_changed', failureStage: 'preflight' });
    expect(drafts.writeDraft).not.toHaveBeenCalled();
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
