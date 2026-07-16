import { describe, expect, it, vi } from 'vitest';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import { PluginBundleToolHost } from './plugin-bundle-tool-host.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('plugin bundle tool host', () => {
  it('gates plugin tools by feature and requires approval for capability mutations', async () => {
    const store = pluginStoreFixture();
    const host = new PluginBundleToolHost(store);

    await expect(host.listTools({ threadId: 'thread_1', features: { plugins: false } })).resolves.toEqual([]);
    await expect(host.listTools({ threadId: 'thread_1', features: { plugins: true } })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'install_plugin_bundle' }),
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
    const host = new PluginBundleToolHost(store);

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
});

function pluginStoreFixture(): PluginBundleStore {
  return {
    listPlugins: vi.fn(async () => ({
      plugins: [{
        id: 'demo',
        name: 'Demo',
        installedAt: '2026-07-15T00:00:00.000Z',
        skills: [],
        mcpServers: [],
        hookCount: 0,
        resources: [{ id: 'guide', label: 'Guide', path: 'guide.md', size: 7 }],
      }],
    })),
    inspectPlugin: vi.fn(async () => ({
      id: 'demo',
      name: 'Demo',
      tags: [],
      featured: false,
      capabilities: { skills: 0, mcpServers: 0, hooks: 0, resources: 0 },
      sourcePath: '/tmp/demo',
    })),
    installPlugin: vi.fn(async () => ({
      plugin: {
        id: 'demo',
        name: 'Demo',
        installedAt: '2026-07-15T00:00:00.000Z',
        skills: [],
        mcpServers: [],
        hookCount: 0,
        resources: [],
      },
      installedMcpServers: [],
      reusedMcpServers: [],
    })),
    removePlugin: vi.fn(async () => ({ pluginId: 'demo', removedMcpServers: [], preservedMcpServers: [] })),
    listInstalledRecords: vi.fn(async () => []),
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
