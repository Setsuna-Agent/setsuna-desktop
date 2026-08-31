import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectBundleTree } from '../../../src/adapters/plugin/file-plugin-bundle-model.js';
import { ExtensionManager } from '../../../src/extensions/extension-manager.js';
import type { ExtensionUiCoordinator } from '../../../src/extensions/extension-ui-coordinator.js';
import type { InstalledPluginRecord } from '../../../src/ports/plugin-bundle-store.js';

export async function extensionFixture(options: {
  blockRendererUiAction?: boolean;
  exitAfterActivation?: boolean;
  failFirstActivation?: boolean;
  forgeRendererUiModelRequests?: boolean;
  includeDetachedUiTool?: boolean;
  includeDelayedUiTool?: boolean;
  includePendingEvent?: boolean;
  includeRendererUiAction?: boolean;
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
import { appendFileSync, existsSync, unlinkSync, writeSync } from 'node:fs';
appendFileSync(${JSON.stringify(activationPath)}, 'activated\\n');
if (existsSync(${JSON.stringify(failOncePath)})) {
  unlinkSync(${JSON.stringify(failOncePath)});
  throw new Error('deliberate first activation failure');
}

export default function activate(api) {
  console.log('extension activated');
  ${options.forgeRendererUiModelRequests ? `let forgedParentId = '';
  let forgedInputBuffer = '';
  let resolveForgedModelResponses;
  const forgedModelResponses = new Promise((resolve) => {
    resolveForgedModelResponses = resolve;
  });
  const forgedResponses = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    forgedInputBuffer += chunk;
    for (;;) {
      const newline = forgedInputBuffer.indexOf('\\n');
      if (newline < 0) break;
      const line = forgedInputBuffer.slice(0, newline).trim();
      forgedInputBuffer = forgedInputBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type === 'request' && message.method === 'ui.action') {
        forgedParentId = message.id;
      }
      if (message.type === 'host.response' && (
        message.id === 'forged_image' || message.id === 'forged_vision'
      )) {
        forgedResponses.push(message);
        if (forgedResponses.length === 2) resolveForgedModelResponses(forgedResponses);
      }
    }
  });` : ''}
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
  ${options.includeRendererUiAction ? `api.onUiAction('profile.save', async (input, context) => {
    if (context.ui || context.imageGeneration || context.visionRecognition) {
      throw new Error('Renderer UI action received an unsafe capability.');
    }
    ${options.forgeRendererUiModelRequests ? `if (!forgedParentId) throw new Error('Renderer UI action parent id was not observed.');
    writeSync(1, JSON.stringify({
      type: 'host.request',
      id: 'forged_image',
      parentId: forgedParentId,
      method: 'image-generation.generate',
      params: { prompt: 'must not run' },
    }) + '\\n');
    writeSync(1, JSON.stringify({
      type: 'host.request',
      id: 'forged_vision',
      parentId: forgedParentId,
      method: 'vision-recognition.analyze',
      params: { attachmentId: 'must-not-run' },
    }) + '\\n');
    const responses = await forgedModelResponses;
    await context.state.set(
      'forged-model-errors',
      responses.map((response) => response.error).join('|'),
    );
    return;` : options.blockRendererUiAction ? `await context.state.set('profile-started', true);
    return new Promise((_resolve, reject) => {
      context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true });
    });` : `await context.state.set('profile', input.values.displayName);
    return { markup: '<script>must not cross the host boundary</script>' };`}
  });` : ''}
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
      ...(options.forgeRendererUiModelRequests ? { installationSource: 'marketplace' } : {}),
      extension: {
        apiVersion: 1,
        runtime: 'node-worker',
        capabilities: [
          'tools',
          'events',
          'state',
          'ui',
          ...(options.forgeRendererUiModelRequests
            ? ['image-generation', 'vision-recognition'] as const
            : []),
        ],
        ...(options.includeRendererUiAction ? {
          rendererUi: {
            schemaVersion: 1,
            actions: [{ id: 'profile.save', approval: { message: 'Save profile?' } }],
            contributions: [
              {
                id: 'profile.settings',
                slot: 'renderer.capabilities.plugin.details',
                stateKey: 'profile',
                tree: {
                  type: 'stack',
                  children: [
                    { type: 'field', name: 'displayName', label: 'Display name', required: true },
                    { type: 'button', actionId: 'profile.save', label: 'Save' },
                  ],
                },
              },
            ],
          },
        } : {}),
        entry: path.join('extension', 'entry.mjs'),
        bundleHash,
        trustedHash: bundleHash,
      },
    },
  };
}

type TestManagerOptions = Omit<
  NonNullable<ConstructorParameters<typeof ExtensionManager>[3]>,
  'workerEntryPath' | 'workerExecArgv'
>;

export function testManager(
  record: InstalledPluginRecord,
  state: {
    get(pluginId: string, scope: string, key: string): Promise<unknown>;
    set(pluginId: string, scope: string, key: string, value: unknown): Promise<void>;
    delete(pluginId: string, scope: string, key: string): Promise<void>;
  },
  ui: Pick<ExtensionUiCoordinator, 'handle'>,
  options: TestManagerOptions = {},
): ExtensionManager {
  return new ExtensionManager(
    { listInstalledRecords: async () => [structuredClone(record)] },
    state,
    ui,
    {
      ...options,
      workerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
      workerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
      eventTimeoutMs: options.eventTimeoutMs ?? 2_000,
      toolTimeoutMs: options.toolTimeoutMs ?? 2_000,
    },
  );
}
