import { createServer } from 'node:http';
import { expect, it, vi } from 'vitest';
import type { Assistant, AssistantsSnapshot, AssistantWebSocket } from '@setsuna-desktop/feature-assistants/contracts';
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import * as hosts from '../../../src/composition/assistants-runtime-host.js';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { readRequestText } from '../../support/runtime-server/shared.js';

it('QQ 中的请求通过真实助理工具保存提醒，重启后在同一聊天按配置强度生成并主动发回原 QQ，删除后停止', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  const requests: { messages: unknown[]; tools: { function: { name: string } }[]; reasoning_effort?: string }[] = [];
  const provider = createServer(async (request, response) => {
    requests.push(JSON.parse(await readRequestText(request)));
    const delta = requests.length === 1 ? { tool_calls: [{ index: 0, id: 'save_reminder', type: 'function', function: {
      name: 'assistant_manage_reminder', arguments: JSON.stringify({ mode: 'create', title: '早安', instructions: '给我发一句早安',
        schedule: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' } }),
    } }] } : { content: requests.length === 2 ? '已设置每天早上九点的问候。' : '早上好！' };
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    response.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  const secrets = new Map<string, string>();
  const sent: { url: string; body: { content: string; msg_id?: string } }[] = [];
  let socket: AssistantWebSocket | undefined;
  const createHost = hosts.createAssistantsRuntimeHost;
  const host = vi.spyOn(hosts, 'createAssistantsRuntimeHost').mockImplementation((runtime) => ({
    ...createHost(runtime),
    secrets: { get: async (key) => secrets.get(key), set: async (key, value) => { secrets.set(key, value); }, delete: async (key) => { secrets.delete(key); } },
    fetch: async (url, init) => {
      if (url.endsWith('/getAppAccessToken')) return Response.json({ access_token: 'test-token', expires_in: 7200 });
      if (url.endsWith('/gateway')) return Response.json({ url: 'wss://qq.test' });
      if (url.endsWith('/messages')) {
        sent.push({ url, body: JSON.parse(String(init?.body)) });
        return Response.json({ id: `sent_${sent.length}` });
      }
      throw new Error(`Unexpected QQ request: ${url}`);
    },
    openWebSocket: () => {
      socket = { send: vi.fn(), close: vi.fn(), onmessage: null, onopen: null, onclose: null, onerror: null };
      return socket;
    },
  }));
  let harness: RuntimeServerTestHarness | undefined;
  try {
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Missing provider address');
    harness = await createRuntimeServerTestHarness();
    await harness.configureOpenAiProvider('reminder-test', `http://127.0.0.1:${address.port}/v1`, {
      contextWindowTokens: 32_000, thinkingEnabled: true, thinkingEfforts: ['high'],
    });
    const assistant = await harness.runtimeFetch('/v1/features/assistants', { method: 'POST', body: JSON.stringify({ draft: {
      name: '助理', personality: '', projectIds: [], thinkingEffort: 'high',
      modelSelection: { providerId: 'reminder-test', modelId: 'reminder-test-model' }, qq: { appId: '123', enabled: true, markdownEnabled: false },
    } }) }) as Assistant;
    const base = `/v1/features/assistants/${assistant.id}`;
    const { threadId } = await harness.runtimeFetch(`${base}/conversation`, { method: 'POST' });
    await harness.runtimeFetch(`${base}/qq-secret`, { method: 'PUT', body: JSON.stringify({ secret: 'test-secret' }) });
    await vi.waitFor(() => expect(socket?.onmessage).toBeTypeOf('function'));
    const inbound = (id: string) => socket!.onmessage!({ data: JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE',
      d: { id, content: '每天早上九点给我发一句早安', author: { user_openid: 'requester' } },
    }) });
    inbound('authorization');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await harness.runtimeFetch(`${base}/peers`, { method: 'PATCH', body: JSON.stringify({ peer: { kind: 'c2c', openid: 'requester', status: 'allowed' } }) });
    const requestId = `qq_request_${'opaque_part_'.repeat(20)}`;
    inbound(requestId);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    await harness.waitForThread(threadId, (thread) => !thread.activeTurnId && thread.turns?.[0]?.status === 'completed');
    let snapshot = await harness.runtimeFetch('/v1/features/assistants') as AssistantsSnapshot;
    expect(snapshot.reminders).toEqual([expect.objectContaining({ status: 'active', nextRunAt: '2026-10-01T01:00:00.000Z', peer: { kind: 'c2c', openid: 'requester' } })]);
    expect(sent[1]?.body.msg_id).toBe(requestId);
    expect(requests[0]?.tools.map((tool) => tool.function.name)).toContain('assistant_manage_reminder');
    expect(requests[0]?.tools.map((tool) => tool.function.name)).not.toContain('run_shell_command');

    await harness.server.close();
    socket = undefined;
    await harness.startRuntimeServer(harness.runtimeDataDir);
    await vi.waitFor(() => expect(socket?.onmessage).toBeTypeOf('function'));
    vi.setSystemTime(new Date('2026-10-01T01:00:00Z'));
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    snapshot = await harness.runtimeFetch('/v1/features/assistants') as AssistantsSnapshot;
    const run = snapshot.reminders[0]!.lastRun!;
    expect(run.threadId).toBe(threadId);
    await harness.waitForCompletedTurn(threadId, run.turnId!);
    expect(sent[2]).toEqual({ url: 'https://api.sgroup.qq.com/v2/users/requester/messages', body: { content: '早上好！', msg_type: 0 } });
    expect(requests).toHaveLength(3);
    expect(requests[2]?.reasoning_effort).toBe('high');
    expect(JSON.stringify(requests[2]?.messages)).toContain('每天早上九点给我发一句早安');
    expect(snapshot.conversations).toHaveLength(1);
    expect(snapshot.reminders[0]?.nextRunAt).toBe('2026-10-02T01:00:00.000Z');
    await harness.runtimeFetch(`${base}/sidebar/reminder/${snapshot.reminders[0]!.id}`, { method: 'DELETE' });
    vi.setSystemTime(new Date('2026-10-02T01:00:00Z'));
    await vi.advanceTimersByTimeAsync(5_000);
    const thread = await harness.runtimeFetch(`/v1/threads/${threadId}`) as RuntimeThread;
    expect(thread.turns).toHaveLength(2);
    expect(sent).toHaveLength(3);
    expect((await harness.runtimeFetch('/v1/features/assistants') as AssistantsSnapshot).reminders).toEqual([]);
  } finally {
    await harness?.close();
    await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
    host.mockRestore();
    vi.useRealTimers();
  }
});
