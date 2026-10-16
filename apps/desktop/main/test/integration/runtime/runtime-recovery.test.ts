import type { DesktopRuntimeEventPayload, RuntimeThread } from '@setsuna-desktop/contracts';
import { sampleRuntimeResources, type ProcessResourceSnapshot } from '@setsuna-desktop/feature-runtime-activity/contracts';
import type { WebContents } from 'electron';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, it, vi } from 'vitest';
import { createRuntimeBuildOptions } from '../../../../../../scripts/build-electron.js';
import { createFeaturePackageSourceAliases } from '../../../../../../scripts/feature-package-aliases.js';
import { RuntimeHost } from '../../../src/runtime/host.js';

it('recovers a killed runtime, resumes existing subscriptions and settles the turn without replaying it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-recovery-'));
  const entry = path.join(root, 'cli.cjs');
  // Compile the actual CLI from source, with only the two native packages external.
  // NODE_PATH keeps those installed dependencies available from the isolated fixture.
  vi.stubEnv('NODE_PATH', path.resolve('node_modules'));
  let providerCalls = 0;
  const provider = createServer((request, response) => {
    request.resume();
    providerCalls += 1;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({
      id: 'recovery-response', object: 'chat.completion.chunk', model: 'recovery-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Before the crash' }, finish_reason: null }],
    })}\n\n`);
    // Keep the turn active until the runtime is killed; a replay would contact us again.
  });
  const onExit = vi.fn(async () => undefined);
  const host = new RuntimeHost({ appRoot: process.cwd(), appVersion: 'test', dataDir: path.join(root, 'data'), runtimeEntry: entry, onExit });
  const events: DesktopRuntimeEventPayload[] = [];
  const renderer = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (_channel: string, payload: DesktopRuntimeEventPayload) => events.push(payload),
  }) as unknown as WebContents;
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    await build({
      ...createRuntimeBuildOptions(process.cwd())[0], outfile: entry, sourcemap: false,
      alias: {
        '@setsuna-desktop/contracts': path.resolve('packages/contracts/src/index.ts'),
        ...createFeaturePackageSourceAliases(process.cwd()),
      },
    });
    provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Provider fixture has no port');
    const start = performance.now();
    await host.start();
    const coldReadyMs = performance.now() - start;
    expect(onExit).not.toHaveBeenCalled();
    const initial = await host.request<ProcessResourceSnapshot>({ path: sampleRuntimeResources.path });
    const pid = initial.processes[0]!.pid;
    expect(pid).not.toBe(process.pid);
    await host.request({ path: '/v1/features/model-provider/settings', method: 'PUT', body: {
      activeProviderId: 'recovery', providers: [{
        id: 'recovery', name: 'Recovery fixture', provider: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fixture', enabled: true,
        models: [{ id: 'recovery-model', name: 'Recovery model', code: 'recovery-model', enabled: true,
          maxOutputTokens: 1000, thinkingEnabled: false, thinkingEfforts: [] }],
      }],
    } });
    const thread = await host.request<RuntimeThread>({ path: '/v1/threads', method: 'POST', body: { title: 'Recovery fixture' } });
    const threadPath = `/v1/threads/${thread.id}`;
    host.subscribeEvents(renderer, { threadId: thread.id, sinceSeq: thread.lastSeq });
    await host.request({ path: `${threadPath}/turns`, method: 'POST', body: { input: 'Keep this turn open.' } });
    await vi.waitFor(() => expect(providerCalls).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(events.flatMap((payload) => payload.batch?.events ?? []).some((event) => event.type === 'turn.started')).toBe(true));
    const active = await host.request<RuntimeThread>({ path: threadPath });
    expect(active.activeTurnId).toBeTruthy();
    const callsBeforeCrash = providerCalls;
    const lastDeliveredSeq = Math.max(...events.flatMap((payload) => payload.batch?.events.map((event) => event.seq) ?? []));
    const recovering = performance.now();
    process.kill(pid, 'SIGKILL');
    await vi.waitFor(async () => {
      const resources = await host.request<ProcessResourceSnapshot>({ path: sampleRuntimeResources.path });
      expect(resources.processes[0]!.pid).not.toBe(pid);
    }, { timeout: 35_000, interval: 250 });
    const recoveredReadyMs = performance.now() - recovering;
    await vi.waitFor(() => {
      const terminal = events.flatMap((payload) => payload.batch?.events ?? [])
        .find((event) => event.type === 'turn.cancelled' && event.turnId === active.activeTurnId);
      expect(terminal?.seq).toBeGreaterThan(lastDeliveredSeq);
    }, { timeout: 10_000 });
    const recovered = await host.request<RuntimeThread>({ path: threadPath });
    expect(recovered.activeTurnId).toBeNull();
    expect(recovered.turns?.find((turn) => turn.id === active.activeTurnId)?.status).toBe('cancelled');
    expect(providerCalls).toBe(callsBeforeCrash);
    const sequences = events.flatMap((payload) => payload.batch?.events.map((event) => event.seq) ?? []);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(onExit).toHaveBeenCalledOnce();
    // New requests continue through the same host; the Electron renderer need not reload.
    await host.request({ path: threadPath, method: 'PATCH', body: { title: 'Recovered successfully' } });
    expect((await host.request<RuntimeThread>({ path: threadPath })).title).toBe('Recovered successfully');
    process.stdout.write(`Runtime readiness (ms): ${JSON.stringify({ cold: Math.round(coldReadyMs), afterCrash: Math.round(recoveredReadyMs) })}\n`);
  } finally {
    await host.stop();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    warning.mockRestore(); vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
