import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { inspectBundleTree } from '../../src/adapters/plugin/file-plugin-bundle-model.js';
import { ExtensionManager } from '../../src/extensions/extension-manager.js';
import { sanitizedExtensionEnvironment } from '../../src/extensions/extension-worker-client.js';
import type { InstalledPluginRecord } from '../../src/ports/plugin-bundle-store.js';

describe('extension manager', () => {
  it('loads trusted workers, exposes namespaced tools, state, UI, and lifecycle handlers', async () => {
    const fixture = await extensionFixture();
    const stateValues = new Map<string, unknown>();
    const state = {
      get: vi.fn(async (_pluginId: string, scope: string, key: string) => stateValues.get(`${scope}:${key}`)),
      set: vi.fn(async (_pluginId: string, scope: string, key: string, value: unknown) => {
        stateValues.set(`${scope}:${key}`, value);
      }),
      delete: vi.fn(async (_pluginId: string, scope: string, key: string) => {
        stateValues.delete(`${scope}:${key}`);
      }),
    };
    const ui = { handle: vi.fn(async () => null) };
    const manager = testManager(fixture.record, state, ui);

    try {
      const tools = await manager.listTools({ threadId: 'thread_1', projectId: 'project_1' });
      expect(tools.map((tool) => tool.name)).toEqual([
        'extension__worker-demo__echo',
        'extension__worker-demo__slow',
      ]);
      expect(tools[0].plugin).toEqual({ id: 'worker-demo', name: 'Worker Demo' });

      const output: string[] = [];
      const result = await manager.runTool(tools[0].name, { text: 'hello' }, {
        threadId: 'thread_1',
        projectId: 'project_1',
        turnId: 'turn_1',
        toolCallId: 'call_1',
        onToolOutputDelta: ({ delta }) => output.push(delta),
      });
      expect(result).toMatchObject({ content: 'thread_1:hello:1', data: { count: 1 } });
      expect(state.set).toHaveBeenCalledWith('worker-demo', 'thread:thread_1', 'count', 1);
      expect(ui.handle).toHaveBeenCalledWith(
        'ui.notify',
        { message: 'ran 1' },
        expect.objectContaining({ threadId: 'thread_1', turnId: 'turn_1', toolCallId: 'call_1' }),
        { id: 'worker-demo', name: 'Worker Demo' },
      );

      const event = await manager.dispatch('prompt.before', {
        threadId: 'thread_1',
        turnId: 'turn_1',
        projectId: 'project_1',
        payload: { input: 'hello extension' },
      });
      expect(event).toEqual({ input: 'HELLO EXTENSION!', context: ['from extension'] });
      await expect(manager.listStatuses()).resolves.toMatchObject({
        extensions: [{ pluginId: 'worker-demo', state: 'running', events: ['prompt.before'] }],
      });

      const finishMutation = await manager.beginPluginMutation('worker-demo');
      await finishMutation();
      await expect(manager.listStatuses()).resolves.toMatchObject({
        extensions: [{ pluginId: 'worker-demo', state: 'stopped' }],
      });
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('does not start untrusted bundles and propagates tool cancellation to the worker', async () => {
    const fixture = await extensionFixture();
    const state = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const ui = { handle: vi.fn(async () => null) };
    const untrusted = {
      ...fixture.record,
      extension: { ...fixture.record.extension!, trustedHash: undefined },
    };
    const untrustedManager = testManager(untrusted, state, ui);
    await expect(untrustedManager.listTools({ threadId: 'thread_1' })).resolves.toEqual([]);
    await untrustedManager.shutdown();

    const manager = testManager(fixture.record, state, ui);
    try {
      const tools = await manager.listTools({ threadId: 'thread_1' });
      const slow = tools.find((tool) => tool.localName === 'slow')!;
      const abort = new AbortController();
      const execution = manager.runTool(slow.name, {}, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        toolCallId: 'call_slow',
        signal: abort.signal,
      });
      abort.abort(new Error('cancelled by test'));
      await expect(execution).rejects.toThrow('cancelled by test');
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('rechecks the exact bundle hash immediately before each tool execution', async () => {
    const fixture = await extensionFixture();
    const manager = testManager(
      fixture.record,
      {
        get: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      { handle: vi.fn(async () => null) },
    );

    try {
      const [tool] = await manager.listTools({ threadId: 'thread_1' });
      await writeFile(fixture.entryPath, '\n// modified after activation\n', { encoding: 'utf8', flag: 'a' });

      await expect(manager.runTool(tool.name, { text: 'must not run' }, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        toolCallId: 'call_modified',
      })).rejects.toThrow('no longer trusted');
      await expect(manager.listStatuses()).resolves.toMatchObject({
        extensions: [{ pluginId: 'worker-demo', state: 'failed' }],
      });
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('passes only an explicit environment allowlist to extension workers', () => {
    expect(sanitizedExtensionEnvironment({
      PATH: 'safe-path',
      TEMP: 'safe-temp',
      SETSUNA_DESKTOP_RUNTIME_TOKEN: 'secret',
      SETSUNA_DESKTOP_NATIVE_BRIDGE_TOKEN: 'secret',
      NODE_OPTIONS: '--inspect',
    })).toEqual({
      PATH: 'safe-path',
      TEMP: 'safe-temp',
      ELECTRON_RUN_AS_NODE: '1',
    });
  });
});

async function extensionFixture(): Promise<{ entryPath: string; record: InstalledPluginRecord; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-test-'));
  const entryDirectory = path.join(root, 'extension');
  const entryPath = path.join(entryDirectory, 'entry.mjs');
  await mkdir(entryDirectory, { recursive: true });
  await writeFile(entryPath, `
export default function activate(api) {
  console.log('extension activated');
  api.registerTool({
    name: 'echo',
    description: 'Echo a value and update state.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const count = Number(await context.state.get('count', 'thread') ?? 0) + 1;
      await context.state.set('count', count, 'thread');
      await context.ui.notify({ message: 'ran ' + count });
      return { content: context.threadId + ':' + input.text + ':' + count, data: { count } };
    },
  });
  api.registerTool({
    name: 'slow',
    description: 'Wait until cancelled.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute(_input, context) {
      return new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true });
      });
    },
  });
  api.on('prompt.before', (payload) => ({
    input: String(payload.input).toUpperCase(),
    context: ['from extension'],
  }));
  api.on('prompt.before', (payload) => ({
    input: String(payload.input) + '!',
  }));
}
`, 'utf8');
  const { bundleHash } = await inspectBundleTree(root);
  return {
    entryPath,
    root,
    record: {
      id: 'worker-demo',
      name: 'Worker Demo',
      installedAt: '2026-08-09T00:00:00.000Z',
      sourcePath: root,
      installPath: root,
      manifestPath: path.join(root, '.setsuna-plugin', 'plugin.json'),
      skills: [],
      skillEntries: [],
      mcpServers: [],
      mcpServerInputs: [],
      hooks: [],
      hookCount: 0,
      resources: [],
      extension: {
        apiVersion: 1,
        runtime: 'node-worker',
        capabilities: ['tools', 'events', 'state', 'ui'],
        entry: path.join('extension', 'entry.mjs'),
        bundleHash,
        trustedHash: bundleHash,
      },
    },
  };
}

function testManager(
  record: InstalledPluginRecord,
  state: {
    get(pluginId: string, scope: string, key: string): Promise<unknown>;
    set(pluginId: string, scope: string, key: string, value: unknown): Promise<void>;
    delete(pluginId: string, scope: string, key: string): Promise<void>;
  },
  ui: { handle(...args: never[]): Promise<unknown> },
): ExtensionManager {
  return new ExtensionManager(
    { listInstalledRecords: async () => [structuredClone(record)] },
    state,
    ui,
    {
      workerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
      workerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
      eventTimeoutMs: 2_000,
      toolTimeoutMs: 2_000,
    },
  );
}
