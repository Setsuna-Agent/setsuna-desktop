import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { normalizeConfigurePluginInput } from '../../src/adapters/tool/configure-plugin-tool.js';
import { FilePluginDraftStore } from '../../src/adapters/plugin/file-plugin-draft-store.js';
import { ExtensionManager } from '../../src/extensions/extension-manager.js';
import { createPluginRuntime } from '../adapters/plugin/support/file-plugin-bundle-store-fixture.js';

describe('chat-authored Plugin details credentials', () => {
  it.each(['plugin-settings.md', 'plugin-settings.en-US.md'])('installs the %s example, saves privately, and uses the key from its worker after an update', async (guide) => {
    const markdown = await readFile(path.resolve('plugins/plugin-builder/skills/create-plugin-in-chat/references', guide), 'utf8');
    const example = markdown.match(/```json\n([\s\S]*?)\n```/u)?.[1];
    if (!example) throw new Error('Configuration example missing');
    const snapshot = normalizeConfigurePluginInput(JSON.parse(example));
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-settings-'));
    const runtime = await createPluginRuntime(root);
    const networkFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-entered-key');
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    });
    const manager = new ExtensionManager(runtime.plugins, runtime.extensionState, { handle: async () => null }, {
      secrets: runtime.extensionSecrets,
      networkFetch,
      workerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
      workerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
    });
    runtime.plugins.setRuntimeMutationCoordinator(manager);
    const drafts = new FilePluginDraftStore(path.join(root, 'drafts'));
    const context = { contributionId: 'settings', surface: 'renderer.capabilities.plugin.details' as const };
    const action = { pluginId: snapshot.pluginId, actionId: 'settings.save', values: {}, context };
    const dataInput = { pluginId: snapshot.pluginId, context };
    try {
      const draft = await drafts.writeDraft(snapshot);
      await runtime.plugins.installPlugin({ path: draft.path }, { trustExtension: true, installationSource: 'local' });
      await expect(manager.readRendererUiData(dataInput)).resolves.toEqual({ data: {}, configuredSecrets: [] });
      await manager.runRendererUiAction({ ...action, secretChanges: { apiKey: 'user-entered-key' } });
      await expect(manager.readRendererUiData(dataInput)).resolves.toEqual({ data: {}, configuredSecrets: ['apiKey'] });
      expect(await readFile(path.join(runtime.dataDir, 'extension-state.json'), 'utf8')).not.toContain('user-entered-key');

      // Update the working example with a real worker/network consumer. Keep the
      // stable field identity so the installed credential survives the update.
      const extension = snapshot.manifest.extension as Record<string, unknown>;
      snapshot.manifest.tools = [{ name: 'search', description: 'Search the configured service.' }];
      snapshot.manifest.extension = {
        ...extension,
        capabilities: ['ui', 'tools', 'network'],
        network: { allowedOrigins: ['https://search.example.test'] },
      };
      snapshot.files[0].content = `export default function activate(api) {
        api.onUiAction('settings.save', async (input) => {
          if (Object.keys(input.values).length || input.secretChanges) throw new Error('Secret edits reached the handler');
        });
        api.registerTool({ name: 'search', description: 'Search service', inputSchema: {type:'object'},
          async execute(input, context) {
            const key = await context.secrets.get(input.name ?? 'apiKey');
            if (!key) return {content:'not configured'};
            const response = await context.network.request({url:'https://search.example.test/query', headers:{Authorization:'Bearer '+key}});
            return {content: response.ok ? 'searched' : 'failed'};
          }
        });
      }`;
      await drafts.writeDraft(snapshot);
      await runtime.plugins.updatePlugin({ path: draft.path }, { trustExtension: true, installationSource: 'local' });
      await manager.runRendererUiAction({ ...action, secretChanges: { apiKey: '' } });
      const toolContext = { threadId: 'thread', turnId: 'turn', toolCallId: 'lookup' };
      const tool = (await manager.listTools(toolContext))[0];
      expect(tool).toBeDefined();
      await expect(manager.runTool(tool.name, {}, toolContext)).resolves.toMatchObject({ content: 'searched' });
      expect(networkFetch).toHaveBeenCalledOnce();
      await expect(manager.runTool(tool.name, { name: 'another-plugin-key' }, toolContext)).rejects.toThrow('not declared');
      await expect(manager.runRendererUiAction({ ...action, values: { apiKey: 'leak' } })).rejects.toThrow('secretChanges');
      await expect(manager.runRendererUiAction({ ...action, secretChanges: { unknown: 'wrong-field' } })).rejects.toThrow('Invalid');

      await runtime.plugins.setExtensionTrust(snapshot.pluginId, false);
      await expect(manager.readRendererUiData(dataInput)).rejects.toThrow('not trusted');
      await expect(manager.runRendererUiAction({ ...action, secretChanges: { apiKey: 'untrusted-write' } })).rejects.toThrow('not trusted');
      await expect(runtime.extensionSecrets.get(snapshot.pluginId, 'apiKey')).resolves.toBe('user-entered-key');
      await runtime.plugins.setExtensionTrust(snapshot.pluginId, true);
      await manager.runRendererUiAction({ ...action, secretChanges: { apiKey: null } });
      await expect(manager.readRendererUiData(dataInput)).resolves.toEqual({ data: {}, configuredSecrets: [] });
      await expect(manager.runTool(tool.name, {}, toolContext)).resolves.toMatchObject({ content: 'not configured' });
      await manager.runRendererUiAction({ ...action, secretChanges: { apiKey: 'uninstall-me' } });
      await runtime.plugins.removePlugin(snapshot.pluginId);
      await expect(runtime.extensionSecrets.get(snapshot.pluginId, 'apiKey')).resolves.toBeUndefined();
    } finally {
      await manager.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
});
