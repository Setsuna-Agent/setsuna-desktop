import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { inspectBundleTree } from '../../src/adapters/plugin/file-plugin-bundle-model.js';
import { ExtensionManager } from '../../src/extensions/extension-manager.js';
import type { ExtensionUiContext, ExtensionUiCoordinator } from '../../src/extensions/extension-ui-coordinator.js';
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
        'extension__worker-demo__blocked',
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

  it('does not start untrusted bundles and replaces a worker that ignores cancellation', async () => {
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
      const blocked = tools.find((tool) => tool.localName === 'blocked')!;
      const abort = new AbortController();
      const execution = manager.runTool(blocked.name, {}, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        toolCallId: 'call_blocked',
        signal: abort.signal,
      });
      setTimeout(() => abort.abort(new Error('cancelled by test')), 30);
      await expect(execution).rejects.toThrow('cancelled by test');
      await expect(manager.listStatuses()).resolves.toMatchObject({
        extensions: [{ pluginId: 'worker-demo', state: 'stopped' }],
      });

      const restartedTools = await manager.listTools({ threadId: 'thread_1' });
      const echo = restartedTools.find((tool) => tool.localName === 'echo')!;
      await expect(manager.runTool(echo.name, { text: 'restarted' }, {
        threadId: 'thread_1',
        turnId: 'turn_2',
        toolCallId: 'call_echo',
      })).resolves.toMatchObject({ content: 'thread_1:restarted:1' });
      expect((await readFile(fixture.activationPath, 'utf8')).trim().split('\n')).toHaveLength(2);
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('propagates lifecycle cancellation instead of converting it into a block', async () => {
    const fixture = await extensionFixture({ includePendingEvent: true });
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
      const abort = new AbortController();
      const dispatch = manager.dispatch('prompt.before', {
        threadId: 'thread_1',
        turnId: 'turn_1',
        signal: abort.signal,
        payload: { input: 'cancel me' },
      });
      setTimeout(() => abort.abort(new Error('lifecycle cancelled by test')), 30);

      await expect(dispatch).rejects.toThrow('lifecycle cancelled by test');
      await expect(manager.listStatuses()).resolves.toMatchObject({
        extensions: [{ pluginId: 'worker-demo', state: 'stopped' }],
      });
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('ignores a host UI reply that arrives after its parent request is cancelled', async () => {
    const fixture = await extensionFixture({ includeDelayedUiTool: true });
    let resolveUi!: (value: unknown) => void;
    const delayedUi = new Promise<unknown>((resolve) => {
      resolveUi = resolve;
    });
    const manager = testManager(
      fixture.record,
      {
        get: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      { handle: vi.fn(async () => delayedUi) },
    );
    try {
      const tools = await manager.listTools({ threadId: 'thread_1' });
      const delayed = tools.find((tool) => tool.localName === 'delayed-ui')!;
      const abort = new AbortController();
      const execution = manager.runTool(delayed.name, {}, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        toolCallId: 'call_delayed_ui',
        signal: abort.signal,
      });
      setTimeout(() => abort.abort(new Error('cancelled while waiting for UI')), 30);
      await expect(execution).rejects.toThrow('cancelled while waiting for UI');

      resolveUi(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const restartedTools = await manager.listTools({ threadId: 'thread_1' });
      const echo = restartedTools.find((tool) => tool.localName === 'echo')!;
      await expect(manager.runTool(echo.name, { text: 'still-alive' }, {
        threadId: 'thread_1',
        turnId: 'turn_2',
        toolCallId: 'call_echo',
      })).resolves.toMatchObject({ content: 'thread_1:still-alive:1' });
    } finally {
      resolveUi?.(false);
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('cancels a host UI request when its parent worker request times out', async () => {
    const fixture = await extensionFixture({ includeDelayedUiTool: true });
    let notifyUiStarted!: (signal: AbortSignal) => void;
    const uiStarted = new Promise<AbortSignal>((resolve) => {
      notifyUiStarted = resolve;
    });
    const ui = {
      handle: vi.fn(async (_method: string, _params: unknown, context: ExtensionUiContext) => {
        const signal = context.signal;
        if (!signal) throw new Error('Expected a request-scoped signal.');
        notifyUiStarted(signal);
        return new Promise<never>((_resolve, reject) => {
          const cancel = () => reject(signal.reason);
          if (signal.aborted) cancel();
          else signal.addEventListener('abort', cancel, { once: true });
        });
      }),
    };
    const manager = testManager(
      fixture.record,
      {
        get: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      ui,
      { toolTimeoutMs: 75 },
    );

    try {
      const tools = await manager.listTools({ threadId: 'thread_1' });
      const delayed = tools.find((tool) => tool.localName === 'delayed-ui')!;
      const execution = manager.runTool(delayed.name, {}, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        toolCallId: 'call_delayed_ui',
      });
      const signal = await uiStarted;

      await expect(execution).rejects.toThrow('timed out after 75ms');
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toEqual(expect.objectContaining({ message: 'Extension request timed out after 75ms.' }));
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('cancels a detached host UI request when its parent completes', async () => {
    const fixture = await extensionFixture({ includeDetachedUiTool: true });
    let notifyUiStarted!: (signal: AbortSignal) => void;
    let notifyUiCancelled!: (reason: unknown) => void;
    const uiStarted = new Promise<AbortSignal>((resolve) => {
      notifyUiStarted = resolve;
    });
    const uiCancelled = new Promise<unknown>((resolve) => {
      notifyUiCancelled = resolve;
    });
    const state = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const manager = testManager(
      fixture.record,
      state,
      {
        handle: vi.fn(async (_method: string, _params: unknown, context: ExtensionUiContext) => {
          const signal = context.signal;
          if (!signal) throw new Error('Expected a request-scoped signal.');
          notifyUiStarted(signal);
          return new Promise<never>((_resolve, reject) => {
            const cancel = () => {
              notifyUiCancelled(signal.reason);
              reject(signal.reason);
            };
            if (signal.aborted) cancel();
            else signal.addEventListener('abort', cancel, { once: true });
          });
        }),
      },
    );

    try {
      const tools = await manager.listTools({ threadId: 'thread_1' });
      const detached = tools.find((tool) => tool.localName === 'detached-ui')!;
      const execution = manager.runTool(detached.name, {}, {
        threadId: 'thread_1',
        turnId: 'turn_1',
        toolCallId: 'call_detached_ui',
      });
      const signal = await uiStarted;

      await expect(execution).resolves.toMatchObject({ content: 'parent complete' });
      await expect(uiCancelled).resolves.toEqual(expect.objectContaining({
        message: 'Extension parent request completed.',
      }));
      expect(signal.aborted).toBe(true);

      const status = tools.find((tool) => tool.localName === 'detached-ui-status')!;
      await expect(manager.runTool(status.name, {}, {
        threadId: 'thread_1',
        turnId: 'turn_2',
        toolCallId: 'call_detached_ui_status',
      })).resolves.toMatchObject({ content: 'settled:false;continuation:settled' });
      expect(state.set).not.toHaveBeenCalled();
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('honors the plugin feature flag for tool and lifecycle execution', async () => {
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
      const context = { threadId: 'thread_1', features: { plugins: false } };
      await expect(manager.listTools(context)).resolves.toEqual([]);
      await expect(manager.runTool('extension__worker-demo__echo', {}, context))
        .rejects.toThrow('disabled');
      await expect(manager.dispatch('prompt.before', { ...context, payload: { input: 'hello' } }))
        .resolves.toEqual({});
      await expect(readFile(fixture.activationPath, 'utf8')).rejects.toThrow();
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('ignores privileged tool hints from non-marketplace extensions', async () => {
    const fixture = await extensionFixture();
    const record = {
      ...fixture.record,
      installationSource: 'local' as const,
      tools: [{
        name: 'echo',
        exposure: 'direct' as const,
        supportsParallel: true,
        requiresApproval: false,
        requiresSandboxBypassApproval: false,
      }],
    };
    const manager = testManager(
      record,
      {
        get: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      { handle: vi.fn(async () => null) },
    );

    try {
      const echo = (await manager.listTools({ threadId: 'thread_1' }))
        .find((tool) => tool.localName === 'echo');
      expect(echo).toMatchObject({
        name: 'extension__worker-demo__echo',
        execution: {
          supportsParallel: false,
          requiresApproval: true,
          requiresSandboxBypassApproval: true,
        },
      });
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('serializes concurrent activation attempts for the same plugin', async () => {
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
      await Promise.all(Array.from({ length: 6 }, () => manager.listTools({ threadId: 'thread_1' })));
      expect((await readFile(fixture.activationPath, 'utf8')).trim().split('\n')).toHaveLength(1);
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('does not let a stale activation failure stop a newer worker', async () => {
    const fixture = await extensionFixture({ failFirstActivation: true });
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
      const results = await Promise.all([
        manager.listTools({ threadId: 'thread_1' }),
        manager.listTools({ threadId: 'thread_2' }),
      ]);
      expect(results.some((tools) => tools.some((tool) => tool.localName === 'echo'))).toBe(true);
      await expect(manager.listStatuses()).resolves.toMatchObject({
        extensions: [{ pluginId: 'worker-demo', state: 'running' }],
      });
      expect((await readFile(fixture.activationPath, 'utf8')).trim().split('\n')).toHaveLength(2);
    } finally {
      await manager.shutdown();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('marks an idle worker that exits after activation as failed', async () => {
    const fixture = await extensionFixture({ exitAfterActivation: true });
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
      await expect(manager.listTools({ threadId: 'thread_1' })).resolves.not.toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 150));

      await expect(manager.listStatuses()).resolves.toMatchObject({
        extensions: [{
          pluginId: 'worker-demo',
          state: 'failed',
          error: 'Extension worker exited unexpectedly.',
        }],
      });
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

async function extensionFixture(options: {
  exitAfterActivation?: boolean;
  failFirstActivation?: boolean;
  includeDetachedUiTool?: boolean;
  includeDelayedUiTool?: boolean;
  includePendingEvent?: boolean;
} = {}): Promise<{
  activationPath: string;
  entryPath: string;
  record: InstalledPluginRecord;
  root: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-test-'));
  const pluginRoot = path.join(root, 'plugin');
  const entryDirectory = path.join(pluginRoot, 'extension');
  const entryPath = path.join(entryDirectory, 'entry.mjs');
  const activationPath = path.join(root, 'activations.log');
  const failOncePath = path.join(root, 'fail-once');
  await mkdir(entryDirectory, { recursive: true });
  if (options.failFirstActivation) await writeFile(failOncePath, '1', 'utf8');
  await writeFile(entryPath, `
import { appendFileSync, existsSync, unlinkSync } from 'node:fs';
appendFileSync(${JSON.stringify(activationPath)}, 'activated\\n');
if (existsSync(${JSON.stringify(failOncePath)})) {
  unlinkSync(${JSON.stringify(failOncePath)});
  throw new Error('deliberate first activation failure');
}

export default function activate(api) {
  console.log('extension activated');
  ${options.exitAfterActivation ? 'setTimeout(() => process.exit(17), 50);' : ''}
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
    name: 'blocked',
    description: 'Ignore cancellation while blocking the worker event loop.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute() {
      for (;;) { /* deliberately CPU-bound for cancellation recovery coverage */ }
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
  ${options.includeDelayedUiTool ? `api.registerTool({
    name: 'delayed-ui',
    description: 'Wait for a host UI response.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_input, context) {
      const approved = await context.ui.confirm({ title: 'Continue?' });
      return { content: String(approved) };
    },
  });` : ''}
  ${options.includeDetachedUiTool ? `let detachedUi;
  let detachedContinuation;
  api.registerTool({
    name: 'detached-ui',
    description: 'Start host UI without awaiting its response.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute(_input, context) {
      detachedUi = context.ui.confirm({ title: 'Detached?' });
      detachedContinuation = detachedUi.then((approved) => (
        context.state.set('late-after-parent', approved, 'thread')
      ));
      return { content: 'parent complete' };
    },
  });
  api.registerTool({
    name: 'detached-ui-status',
    description: 'Report whether the detached host call settled.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const status = await Promise.race([
        detachedUi.then(
          (value) => 'settled:' + String(value),
          () => 'rejected',
        ),
        new Promise((resolve) => setTimeout(() => resolve('pending'), 100)),
      ]);
      const continuation = await Promise.race([
        detachedContinuation.then(
          () => 'settled',
          () => 'rejected',
        ),
        new Promise((resolve) => setTimeout(() => resolve('pending'), 100)),
      ]);
      return { content: status + ';continuation:' + continuation };
    },
  });` : ''}
  ${options.includePendingEvent ? `api.on('prompt.before', (_payload, context) => (
    new Promise((_resolve, reject) => {
      context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true });
    })
  ));` : ''}
  api.on('prompt.before', (payload) => ({
    input: String(payload.input).toUpperCase(),
    context: ['from extension'],
  }));
  api.on('prompt.before', (payload) => ({
    input: String(payload.input) + '!',
  }));
}
`, 'utf8');
  const { bundleHash } = await inspectBundleTree(pluginRoot);
  return {
    activationPath,
    entryPath,
    root,
    record: {
      id: 'worker-demo',
      name: 'Worker Demo',
      installedAt: '2026-08-09T00:00:00.000Z',
      sourcePath: pluginRoot,
      installPath: pluginRoot,
      manifestPath: path.join(pluginRoot, '.setsuna-plugin', 'plugin.json'),
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
  ui: Pick<ExtensionUiCoordinator, 'handle'>,
  options: { eventTimeoutMs?: number; toolTimeoutMs?: number } = {},
): ExtensionManager {
  return new ExtensionManager(
    { listInstalledRecords: async () => [structuredClone(record)] },
    state,
    ui,
    {
      workerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
      workerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
      eventTimeoutMs: options.eventTimeoutMs ?? 2_000,
      toolTimeoutMs: options.toolTimeoutMs ?? 2_000,
    },
  );
}
