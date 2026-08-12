import { WEB_SEARCH_PLUGIN_ID, WEB_SEARCH_TOOL_NAME } from '@setsuna-desktop/contracts';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  inspectBundleTree,
  readPluginManifest,
} from '../../src/adapters/plugin/file-plugin-bundle-model.js';
import { ExtensionToolHost } from '../../src/adapters/tool/extension-tool-host.js';
import type { ExtensionNetworkFetch } from '../../src/extensions/extension-network-coordinator.js';
import { ExtensionManager } from '../../src/extensions/extension-manager.js';
import type { InstalledPluginRecord } from '../../src/ports/plugin-bundle-store.js';

describe('bundled web-search extension', () => {
  it('registers a stable direct tool and searches through host-managed networking', async () => {
    const root = path.resolve('plugins/web-search');
    const manifest = await readPluginManifest(root);
    expect(manifest.extension).toMatchObject({
      capabilities: ['tools', 'network'],
      network: { allowedOrigins: ['https://api.tavily.com'] },
    });
    expect(manifest.tools).toEqual([expect.objectContaining({
      name: WEB_SEARCH_TOOL_NAME,
      exposure: 'direct',
      supportsParallel: true,
      requiresApproval: false,
      requiresSandboxBypassApproval: false,
    })]);

    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetchImpl: ExtensionNetworkFetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({
        query: 'current MCP release',
        results: [
          {
            title: 'Official release',
            url: 'https://example.com/releases/latest',
            content: 'Current release notes.',
            score: 0.95,
            published_date: '2026-08-01',
          },
          {
            title: 'Duplicate',
            url: 'https://example.com/releases/latest',
            content: 'Duplicate result.',
          },
          { title: 'Unsafe', url: 'javascript:alert(1)', content: 'Ignore me.' },
        ],
      });
    };
    const manager = await webSearchManager(root, fetchImpl);
    const host = new ExtensionToolHost(manager);
    const context = { threadId: 'thread_1', turnId: 'turn_1', toolCallId: 'call_1' };

    try {
      await expect(host.listTools(context)).resolves.toEqual([
        expect.objectContaining({ name: WEB_SEARCH_TOOL_NAME }),
      ]);
      await expect(host.toolRuntimeProfile(WEB_SEARCH_TOOL_NAME, context)).resolves.toMatchObject({
        supportsParallel: true,
        requiresSandboxBypassApproval: false,
        plugin: { id: WEB_SEARCH_PLUGIN_ID, name: '网络搜索' },
      });
      await expect(host.approvalForTool(WEB_SEARCH_TOOL_NAME, {}, context)).resolves.toBeNull();

      const result = await host.runTool(WEB_SEARCH_TOOL_NAME, {
        query: 'current MCP release',
        max_results: 5,
        topic: 'news',
        time_range: 'week',
        include_domains: ['Example.com', '*.example.com'],
        exclude_domains: ['spam.example'],
      }, context);

      expect(requestUrl).toBe('https://api.tavily.com/search');
      const headers = new Headers(requestInit?.headers);
      expect(headers.get('x-tavily-access-mode')).toBe('keyless');
      expect(headers.get('x-client-source')).toBe('setsuna-desktop');
      expect(JSON.parse(String(requestInit?.body))).toMatchObject({
        query: 'current MCP release',
        max_results: 5,
        topic: 'news',
        time_range: 'week',
        include_domains: ['example.com'],
        exclude_domains: ['spam.example'],
      });
      expect(result).toMatchObject({
        preview: '已找到 1 个网络来源',
        containsExternalContext: true,
        data: {
          pluginId: WEB_SEARCH_PLUGIN_ID,
          provider: 'tavily-keyless',
          resultCount: 1,
          sources: [{
            title: 'Official release',
            url: 'https://example.com/releases/latest',
            score: 0.95,
            publishedDate: '2026-08-01',
          }],
        },
      });
      expect(result.content).toContain('untrusted external content');
      expect(result.content).toContain('URL: https://example.com/releases/latest');
    } finally {
      await manager.shutdown();
    }
  });
});

async function webSearchManager(
  root: string,
  networkFetch: ExtensionNetworkFetch,
): Promise<ExtensionManager> {
  const manifest = await readPluginManifest(root);
  const { bundleHash } = await inspectBundleTree(root);
  const record: InstalledPluginRecord = {
    id: manifest.id,
    name: manifest.name,
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    ...(manifest.version ? { version: manifest.version } : {}),
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(manifest.publisher ? { publisher: manifest.publisher } : {}),
    tags: [...manifest.tags],
    tools: manifest.tools.map((tool) => ({ ...tool })),
    installedAt: '2026-08-12T00:00:00.000Z',
    installationSource: 'marketplace',
    sourcePath: root,
    installPath: root,
    manifestPath: manifest.manifestPath,
    skills: [],
    skillEntries: [],
    mcpServers: [],
    mcpServerInputs: [],
    hooks: [],
    hookCount: 0,
    resources: [],
    extension: {
      ...manifest.extension!,
      capabilities: [...manifest.extension!.capabilities],
      entry: manifest.extension!.entry,
      bundleHash,
      trustedHash: bundleHash,
    },
  };
  return new ExtensionManager(
    { listInstalledRecords: async () => [structuredClone(record)] },
    {
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
    },
    { handle: async () => null },
    {
      workerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
      workerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
      networkFetch,
      toolTimeoutMs: 2_000,
    },
  );
}
