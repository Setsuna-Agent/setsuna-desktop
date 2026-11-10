import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { AssistantsStateStore } from '../../../features/assistants/src/runtime/state-store.js';
import { RandomIdGenerator } from '../../src/adapters/id/random-id-generator.js';
import * as hosts from '../../src/composition/assistants-runtime-host.js';
import { systemClock } from '../../src/ports/clock.js';
import { createRuntimeServer } from '../../src/server/runtime-server.js';
import { InMemoryDesktopNativeBridge } from '../support/in-memory-secret-store.js';
import { createTestThreadStore } from '../support/thread-store.js';

it('旧记录导入和到期提醒的挂起或失败均不阻塞 runtime health 或核心对话列表就绪', async () => {
  const timings: Record<string, number> = {};
  const createHost = hosts.createAssistantsRuntimeHost;
  for (const mode of ['baseline', 'slow', 'failed', 'slow-reminder', 'failed-reminder'] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setsuna-assistant-startup-'));
    const runtimeDir = path.join(root, 'runtime');
    const seed = createTestThreadStore(runtimeDir, systemClock, new RandomIdGenerator());
    const store = new AssistantsStateStore(runtimeDir);
    await store.load();
    const at = new Date().toISOString();
    try {
      await store.mutate(async ({ state }) => {
        state.assistants.push({ id: 'assistant', name: '助理', personality: '', projectIds: [], createdAt: at, updatedAt: at });
        for (const source of mode === 'slow' || mode === 'failed' ? ['local', 'qq-c2c'] as const : ['local'] as const) {
          const thread = await seed.createThread({ title: '旧聊天', featureId: 'assistants', memoryMode: 'disabled' });
          state.conversations.push({ assistantId: 'assistant', threadId: thread.id, source, createdAt: at });
        }
        if (mode.endsWith('reminder')) state.reminders.push({
          id: 'reminder', assistantId: 'assistant', title: '问候', instructions: '发一句早安',
          schedule: { kind: 'once', at }, status: 'active', nextRunAt: at, createdAt: at, updatedAt: at,
        });
      });
    } finally { await store.dispose(); await seed.close(); }
    let release!: (result: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { release = resolve; });
    const merge = vi.fn(async () => {
      if (mode === 'failed') throw new Error('旧记录暂时不可读');
      return pending;
    });
    const trigger = vi.fn(async () => {
      if (mode === 'failed-reminder') throw new Error('提交暂时失败');
      await pending;
      return { turnId: null };
    });
    const host = vi.spyOn(hosts, 'createAssistantsRuntimeHost').mockImplementation((runtime) => ({
      ...createHost(runtime), mergeConversationHistory: merge, deliverMailbox: trigger,
    }));
    const started = performance.now();
    let server: Awaited<ReturnType<typeof createRuntimeServer>> | undefined;
    try {
      server = await createRuntimeServer({ dataDir: root, token: 'test', version: 'test', nativeBridge: new InMemoryDesktopNativeBridge() });
      await server.listen(0);
      if (mode === 'slow' || mode === 'failed') await vi.waitFor(() => expect(merge).toHaveBeenCalled());
      if (mode.endsWith('reminder')) await vi.waitFor(() => expect(trigger).toHaveBeenCalled());
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing runtime address');
      const origin = `http://127.0.0.1:${address.port}`;
      expect((await fetch(`${origin}/health`)).ok).toBe(true);
      expect((await fetch(`${origin}/v1/threads`, { headers: { authorization: 'Bearer test' } })).ok).toBe(true);
      timings[mode] = performance.now() - started;
      if (mode === 'baseline') expect(merge).not.toHaveBeenCalled();
      else if (mode === 'slow') expect(merge).toHaveBeenCalledOnce();
    } finally {
      const closing = server?.close();
      release(true);
      await closing;
      host.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  }
  process.stdout.write(`Assistant background runtime-ready milliseconds: ${JSON.stringify(timings)}\n`);
});
