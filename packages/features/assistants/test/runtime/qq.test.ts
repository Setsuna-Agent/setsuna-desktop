import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantWebSocket } from '../../src/contracts/index.js';
import { AssistantDeliveryOutbox, type AssistantReplySender } from '../../src/runtime/deliveries.js';
import { AssistantsStateStore } from '../../src/runtime/state-store.js';
import { QqConnectorManager } from '../../src/runtime/qq/qq-connector.js';
import { QqApiError } from '../../src/runtime/qq/qq-api.js';
import { completed, fixture } from './fixture.js';
import { deferred } from '../support/deferred.js';

function socket(): AssistantWebSocket {
  return { send: vi.fn(), close: vi.fn(), onopen: null, onmessage: null, onclose: null, onerror: null };
}

describe('QQ 连接与持久回报', () => {
  it('群消息仅处理明确 @，未授权时逐条提示，授权后去重并回到原群', async () => {
    const f = await fixture();
    const configured = await f.directory.update(f.assistant.id, { ...f.assistant, qq: { appId: '123', enabled: true } });
    await f.directory.setQqSecret(f.assistant.id, 'test-secret');
    const ws = socket();
    f.host.openWebSocket = vi.fn(() => ws);
    const mentionId = `qq_group_${'opaque_part_'.repeat(20)}`;
    const connectors = new QqConnectorManager(f.host, f.store, f.directory, f.outbox, f.errors);
    const inbound = (id: string, mentions?: unknown) => ws.onmessage?.({ data: JSON.stringify({
      op: 0, t: 'GROUP_MESSAGE_CREATE', d: {
        id, group_openid: 'group_a', author: { member_openid: 'member' }, content: '你好', mentions,
      },
    }) });
    try {
      await connectors.sync();
      await vi.waitFor(() => expect(ws.onmessage).not.toBeNull());
      inbound('ordinary');
      inbound('mention_other', [{ is_you: false, bot: true }]);
      inbound(mentionId, [{ is_you: true }]);
      await vi.waitFor(() => expect(f.store.current.deliveries[0]?.status).toBe('sent'));
      expect(f.store.current.inbox.map((item) => item.messageId)).toEqual([mentionId]);
      expect(f.store.current.peers).toEqual([expect.objectContaining({ kind: 'group', openid: 'group_a', status: 'pending' })]);
      expect(f.host.startTurn).not.toHaveBeenCalled();
      inbound(mentionId, [{ is_you: true }]);
      inbound('pending_again', [{ is_you: true }]);
      inbound('pending_again', [{ is_you: true }]);
      await vi.waitFor(() => expect(f.store.current.deliveries.find((item) => item.replyToMessageId === 'pending_again')?.status).toBe('sent'));
      await f.store.settled();
      const notices = vi.mocked(f.host.fetch).mock.calls.filter(([url]) => url.endsWith('/v2/groups/group_a/messages'))
        .map(([, init]) => JSON.parse(String(init?.body)));
      expect(notices).toEqual([
        { msg_type: 2, markdown: { content: f.store.current.deliveries[0]?.content }, msg_id: mentionId, msg_seq: 1 },
        { msg_type: 2, markdown: { content: f.store.current.deliveries[1]?.content }, msg_id: 'pending_again', msg_seq: 1 },
      ]);
      expect(f.store.current.peers).toHaveLength(1);
      expect(f.host.startTurn).not.toHaveBeenCalled();
      await f.directory.update(f.assistant.id, { ...configured, qq: { ...configured.qq!, markdownEnabled: false } });
      await connectors.sync();
      expect(f.host.openWebSocket).toHaveBeenCalledTimes(1);
      const restored = new AssistantsStateStore(f.host.dataDir);
      await restored.load();
      try {
        expect(restored.current.assistants[0]?.qq?.markdownEnabled).toBe(false);
        expect(restored.current.inbox[0]?.messageId).toBe(mentionId);
        expect(restored.current.deliveries[0]?.replyToMessageId).toBe(mentionId);
      } finally { await restored.dispose(); }
      await f.directory.updatePeer(f.assistant.id, { kind: 'group', openid: 'group_a', status: 'allowed' });
      vi.mocked(f.host.startTurn).mockImplementation(async () => {
        f.outcomes.set('group_turn', { status: 'completed', finalAnswer: '群内回复' });
        return { turnId: 'group_turn' };
      });
      inbound('authorized', [{ is_you: true }]);
      inbound('authorized', [{ is_you: true }]);
      await vi.waitFor(() => expect(f.store.current.deliveries.find((item) => item.replyToMessageId === 'authorized')?.status).toBe('sent'));
      await f.store.settled();
      expect(f.host.startTurn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(f.host.startTurn).mock.calls[0]?.[0]).toBe(f.conversation.threadId);
      expect(f.outbox.routeForTurn(f.conversation.threadId, 'group_turn')).toMatchObject({
        peer: { kind: 'group', openid: 'group_a' }, initiator: 'member',
      });
      const send = vi.mocked(f.host.fetch).mock.calls.find(([url, init]) => url.endsWith('/v2/groups/group_a/messages')
        && JSON.parse(String(init?.body)).content === '群内回复');
      expect(send).toBeDefined();
      expect(JSON.parse(String(send?.[1]?.body))).toEqual({ content: '群内回复', msg_type: 0, msg_id: 'authorized', msg_seq: 1 });
      inbound('later_ordinary');
      await f.store.settled();
      expect(f.host.startTurn).toHaveBeenCalledTimes(1);
      expect(f.errors).not.toHaveBeenCalled();
    } finally { connectors.dispose(); }
  });

  it('同一会话的排队消息按 clientId 认领执行轮次，完成顺序变化也只回复各自来源，桌面回复不广播', async () => {
    const f = await fixture();
    const at = f.host.now().toISOString();
    const peers = [{ kind: 'c2c' as const, openid: 'user_a' }, { kind: 'c2c' as const, openid: 'user_b' }, { kind: 'group' as const, openid: 'group_a' }];
    await f.store.mutate(({ state }) => {
      for (const peer of peers) {
        state.peers.push({ ...peer, assistantId: f.assistant.id, status: 'allowed', firstSeenAt: at, lastSeenAt: at });
        f.outbox.expectReply(state, { assistantId: f.assistant.id, peer, threadId: f.conversation.threadId, clientId: peer.openid });
      }
    });
    const send = vi.fn<AssistantReplySender['send']>().mockResolvedValue(undefined);
    f.outbox.setSender(f.assistant.id, { send });
    for (const peer of peers) {
      f.outcomes.set(peer.openid, { status: 'running' });
      f.emit({ id: `started_${peer.openid}`, seq: 1, threadId: f.conversation.threadId, turnId: peer.openid, createdAt: at,
        type: 'message.created', payload: { message: { id: `input_${peer.openid}`, role: 'user', content: '消息', createdAt: at, clientId: peer.openid, turnId: peer.openid } } });
    }
    await f.store.settled();
    for (const peer of peers) expect(f.outbox.routeForTurn(f.conversation.threadId, peer.openid)?.peer).toEqual(peer);
    for (const index of [1, 0, 2]) {
      const peer = peers[index]!;
      f.outcomes.set(peer.openid, { status: 'completed', finalAnswer: `只发给 ${peer.openid}` });
      f.emit(completed(f.conversation.threadId, peer.openid));
      await vi.waitFor(() => expect(f.store.current.deliveries.find((item) => item.clientId === peer.openid)?.status).toBe('sent'));
    }
    f.outcomes.set('desktop_turn', { status: 'completed', finalAnswer: '桌面上的回复' });
    f.emit(completed(f.conversation.threadId, 'desktop_turn'));
    await f.store.settled();
    await f.outbox.flush();
    expect(send.mock.calls).toEqual([1, 0, 2].map((index) => [peers[index], { content: `只发给 ${peers[index]!.openid}` }]));
    expect(f.host.startTurn).not.toHaveBeenCalled();
  });

  it('授权后的私聊和群聊都续接同一助理会话，消息去重且保留各自的回复来源', async () => {
    const f = await fixture();
    const configured = await f.directory.update(f.assistant.id, { ...f.assistant, qq: { appId: '123456', enabled: true } });
    await f.directory.setQqSecret(configured.id, 'private-test-secret');
    const ws = socket();
    const connected = deferred<void>();
    f.host.openWebSocket = () => { connected.resolve(); return ws; };
    const connectors = new QqConnectorManager(f.host, f.store, f.directory, f.outbox, f.errors);
    const inbound = (id: string, peer: string, group = false, username?: unknown) => ws.onmessage?.({ data: JSON.stringify({ op: 0,
      t: group ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
      d: { id, content: '继续处理需求', ...(group ? { group_openid: peer } : {}), author: { ...(group ? { member_openid: 'member' } : { user_openid: peer }), username } },
    }) });
    try {
      await connectors.sync();
      await connected.promise;
      await vi.waitFor(() => expect(ws.onmessage).not.toBeNull());
      inbound('first', 'user_a', false, '  用户\n小明  ');
      await vi.waitFor(() => expect(f.store.current.peers).toHaveLength(1));
      expect(f.host.startTurn).not.toHaveBeenCalled();
      await f.directory.updatePeer(configured.id, { kind: 'c2c', openid: 'user_a', status: 'allowed' });
      inbound('second', 'user_a');
      inbound('second', 'user_a');
      await vi.waitFor(() => expect(f.host.startTurn).toHaveBeenCalledTimes(1));
      await f.store.settled();
      expect(vi.mocked(f.host.startTurn).mock.calls[0]?.[0]).toBe(f.conversation.threadId);
      expect(f.store.current.peers[0]).toMatchObject({ openid: 'user_a', displayName: '用户 小明', status: 'allowed' });
      inbound('third', 'user_b');
      inbound('fourth', 'group_a', true, '群成员昵称');
      await vi.waitFor(() => expect(f.store.current.peers).toHaveLength(3));
      await f.directory.updatePeer(configured.id, { kind: 'c2c', openid: 'user_b', status: 'allowed' });
      await f.directory.updatePeer(configured.id, { kind: 'group', openid: 'group_a', status: 'allowed' });
      inbound('fifth', 'user_b');
      inbound('sixth', 'group_a', true);
      await vi.waitFor(() => expect(f.host.startTurn).toHaveBeenCalledTimes(3));
      await f.store.settled();
      const destinations = vi.mocked(f.host.startTurn).mock.calls.map(([threadId]) => threadId);
      expect(destinations).toEqual(Array(3).fill(f.conversation.threadId));
      inbound('seventh', 'user_a', false, '新的昵称');
      inbound('eighth', 'user_b', false, 123);
      inbound('ninth', 'group_a', true);
      await vi.waitFor(() => expect(f.host.startTurn).toHaveBeenCalledTimes(6));
      await f.store.settled();
      expect(vi.mocked(f.host.startTurn).mock.calls.slice(3).map(([threadId]) => threadId)).toEqual(destinations);
      expect(f.host.createConversation).toHaveBeenCalledTimes(1);
      const replies = f.store.current.deliveries.filter((item) => item.clientId);
      expect(replies.map((item) => item.peer.openid)).toEqual(['user_a', 'user_b', 'group_a', 'user_a', 'user_b', 'group_a']);
      expect(new Set(replies.map((item) => item.clientId)).size).toBe(6);
      expect(await readFile(f.file, 'utf8')).not.toContain('private-test-secret');
      const restored = new AssistantsStateStore(f.host.dataDir);
      await restored.load();
      try {
        expect(restored.current.peers).toEqual([
          expect.objectContaining({ kind: 'c2c', openid: 'user_a', displayName: '新的昵称', status: 'allowed' }),
          expect.objectContaining({ kind: 'c2c', openid: 'user_b', status: 'allowed' }),
          expect.objectContaining({ kind: 'group', openid: 'group_a', status: 'allowed' }),
        ]);
        expect(restored.current.peers[1]?.displayName).toBeUndefined();
        expect(restored.current.peers[2]?.displayName).toBeUndefined();
      } finally { await restored.dispose(); }
      expect(f.errors).not.toHaveBeenCalled();
    } finally { connectors.dispose(); }
  });

  it('逐块保存发送进度，重启后只补交剩余内容而不重新执行任务', async () => {
    const f = await fixture();
    const peer = { kind: 'group' as const, openid: 'group_a' };
    const content = '甲'.repeat(1499) + '🚀'.repeat(101);
    await f.store.mutate(({ state }) => {
      state.peers.push({ ...peer, assistantId: f.assistant.id, status: 'allowed', firstSeenAt: f.host.now().toISOString(), lastSeenAt: f.host.now().toISOString() });
      f.outbox.expectReply(state, { assistantId: f.assistant.id, peer, threadId: f.conversation.threadId, projectIds: ['project'], content });
    });
    const send = vi.fn<AssistantReplySender['send']>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new QqApiError('暂时不可用', 503));
    f.outbox.setSender(f.assistant.id, { send });
    await vi.waitFor(() => expect(f.store.current.deliveries[0]).toMatchObject({ status: 'ready', sentChunks: 1, attempts: 1 }));
    expect(JSON.parse(await readFile(f.file, 'utf8')).deliveries[0].sentChunks).toBe(1);
    f.outbox.dispose();
    await f.store.settled();
    const restored = new AssistantsStateStore(f.host.dataDir);
    await restored.load();
    const outbox = new AssistantDeliveryOutbox(f.host, restored, f.errors);
    const resumedSend = vi.fn<AssistantReplySender['send']>().mockResolvedValue(undefined);
    f.advance(5000);
    try {
      outbox.setSender(f.assistant.id, { send: resumedSend });
      await outbox.recover();
      await vi.waitFor(() => expect(restored.current.deliveries[0]?.status).toBe('sent'));
      expect(resumedSend).toHaveBeenCalledTimes(1);
      expect(resumedSend.mock.calls[0]?.[1]).toEqual(send.mock.calls[1]?.[1]);
      const firstChunk = send.mock.calls[0]![1].content;
      const lastChunk = resumedSend.mock.calls[0]![1].content;
      expect(firstChunk + lastChunk).toBe(content);
      expect(firstChunk).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(lastChunk).not.toMatch(/^[\uDC00-\uDFFF]/u);
      expect(f.host.startTurn).not.toHaveBeenCalled();
    } finally { outbox.dispose(); await restored.dispose(); }
  });

  it('官方频控会退避，授权撤销后不再补发，且不施加群主动消息数量上限', async () => {
    const f = await fixture();
    const peer = { kind: 'group' as const, openid: 'group_a' };
    await f.store.mutate(({ state }) => {
      state.peers.push({ ...peer, assistantId: f.assistant.id, status: 'allowed', firstSeenAt: f.host.now().toISOString(), lastSeenAt: f.host.now().toISOString() });
      for (let index = 0; index < 8; index += 1) f.outbox.expectReply(state, { assistantId: f.assistant.id, peer, content: `主动消息 ${index}` });
    });
    const send = vi.fn(async () => undefined);
    f.outbox.setSender(f.assistant.id, { send });
    await vi.waitFor(() => expect(f.store.current.deliveries.filter((item) => item.status === 'sent')).toHaveLength(8));
    expect(send).toHaveBeenCalledTimes(8);
    send.mockRejectedValueOnce(new QqApiError('频控', 400, 40034100));
    await f.store.mutate(({ state }) => { f.outbox.expectReply(state, { assistantId: f.assistant.id, peer, threadId: f.conversation.threadId, projectIds: ['project'], content: '工作结果' }); });
    await f.outbox.flush();
    expect(f.store.current.deliveries.at(-1)?.nextAttemptAt).toBe('2026-10-01T00:01:00.000Z');
    f.advance(59000);
    await f.outbox.flush();
    expect(send).toHaveBeenCalledTimes(9);
    await f.directory.update(f.assistant.id, { ...f.assistant, projectIds: [] });
    f.advance(1000);
    await f.outbox.flush();
    expect(send).toHaveBeenCalledTimes(9);
    expect(f.store.current.deliveries.at(-1)?.status).toBe('failed');
    expect(f.host.startTurn).not.toHaveBeenCalled();
  });
});
