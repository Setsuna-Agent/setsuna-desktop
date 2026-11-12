// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AssistantPeerUpdate, AssistantsSnapshot } from '../../src/contracts/index.js';
import { AssistantConversation } from '../../src/renderer/AssistantConversation.js';
import type { AssistantsClient } from '../../src/renderer/client.js';
import { assistantsMessages } from '../../src/renderer/messages.js';
import { createAssistantsStore } from '../../src/renderer/store.js';
import { deferred } from '../support/deferred.js';

afterEach(cleanup);
const t = (key: string) => assistantsMessages.messages['zh-CN'][key] ?? key;

it('详情未打开时也能授权；失败可重试，重复点击不重复提交，移除同 ID 群聊不授予权限', async () => {
  const f = mountConversation();
  const privateChat = await screen.findByRole('group', { name: '私聊 · 小明' });
  expect(f.client.updatePeer).not.toHaveBeenCalled();
  expect(screen.queryByRole('group', { name: '私聊 · 另一助理的来源' })).toBeNull();
  expect(screen.queryByRole('group', { name: '私聊 · 已授权用户' })).toBeNull();
  const gate = deferred<void>();
  f.client.updatePeer.mockImplementationOnce(async () => { await gate.promise; throw new Error('授权失败'); });
  const allow = within(privateChat).getByRole('button', { name: '允许' });
  fireEvent.click(allow);
  fireEvent.click(allow);
  expect(f.client.updatePeer).toHaveBeenCalledExactlyOnceWith('owner', { kind: 'c2c', openid: 'same-id', status: 'allowed' });
  await act(() => gate.resolve());
  await screen.findByText('授权失败');
  expect(f.service.store.getSnapshot()?.peers.find((peer) => peer.assistantId === 'owner' && peer.openid === 'same-id' && peer.kind === 'c2c')?.status).toBe('pending');
  fireEvent.click(allow);
  await waitFor(() => expect(f.service.store.getSnapshot()?.peers.find((peer) => peer.assistantId === 'owner' && peer.openid === 'same-id' && peer.kind === 'c2c')?.status).toBe('allowed'));
  const groupChat = await screen.findByRole('group', { name: '群聊 · 项目群' });
  fireEvent.click(within(groupChat).getByRole('button', { name: '移除' }));
  await waitFor(() => expect(f.service.store.getSnapshot()?.peers.some((peer) => peer.assistantId === 'owner' && peer.kind === 'group')).toBe(false));
  expect(f.client.updatePeer.mock.calls).toEqual([
    ['owner', { kind: 'c2c', openid: 'same-id', status: 'allowed' }],
    ['owner', { kind: 'c2c', openid: 'same-id', status: 'allowed' }],
    ['owner', { kind: 'group', openid: 'same-id', status: 'removed' }],
  ]);
  expect(f.service.store.getSnapshot()?.peers.find((peer) => peer.assistantId === 'other')?.status).toBe('pending');
  expect(screen.queryByRole('region', { name: 'QQ 授权请求' })).toBeNull();
  expect(f.openConversation).not.toHaveBeenCalled();
});

it('切换助理后旧授权请求的失败不污染新对话，也不会授权新助理下的同 ID 来源', async () => {
  const f = mountConversation();
  const gate = deferred<void>();
  const request = gate.promise.then(() => { throw new Error('旧会话授权失败'); });
  f.client.updatePeer.mockReturnValueOnce(request);
  fireEvent.click(within(await screen.findByRole('group', { name: '私聊 · 小明' })).getByRole('button', { name: '允许' }));
  expect(f.client.updatePeer).toHaveBeenCalledExactlyOnceWith('owner', { kind: 'c2c', openid: 'same-id', status: 'allowed' });
  f.open('other');
  const otherChat = await screen.findByRole('group', { name: '私聊 · 另一助理的来源' });
  await act(async () => { gate.resolve(); await request.catch(() => undefined); });
  expect(screen.queryByText('旧会话授权失败')).toBeNull();
  expect(f.service.store.getSnapshot()?.peers.find((peer) => peer.assistantId === 'other')?.status).toBe('pending');
  fireEvent.click(within(otherChat).getByRole('button', { name: '允许' }));
  await waitFor(() => expect(f.service.store.getSnapshot()?.peers.find((peer) => peer.assistantId === 'other')?.status).toBe('allowed'));
  expect(f.client.updatePeer).toHaveBeenLastCalledWith('other', { kind: 'c2c', openid: 'same-id', status: 'allowed' });
  expect(f.service.store.getSnapshot()?.peers.find((peer) => peer.assistantId === 'owner' && peer.kind === 'c2c')?.status).toBe('pending');
});

function mountConversation() {
  const at = '2026-10-01T00:00:00Z';
  let snapshot: AssistantsSnapshot = {
    assistants: ['owner', 'other'].map((id) => ({ id, name: id, personality: '', projectIds: [], createdAt: at, updatedAt: at })),
    conversations: ['owner', 'other'].map((id) => ({ assistantId: id, threadId: `${id}-shared`, source: 'shared', title: id, createdAt: at, updatedAt: at })),
    peers: [
      { assistantId: 'owner', kind: 'c2c', openid: 'same-id', displayName: '小明', status: 'pending', firstSeenAt: at, lastSeenAt: at },
      { assistantId: 'owner', kind: 'group', openid: 'same-id', displayName: '项目群', status: 'pending', firstSeenAt: at, lastSeenAt: at },
      { assistantId: 'owner', kind: 'c2c', openid: 'allowed', displayName: '已授权用户', status: 'allowed', firstSeenAt: at, lastSeenAt: at },
      { assistantId: 'other', kind: 'c2c', openid: 'same-id', displayName: '另一助理的来源', status: 'pending', firstSeenAt: at, lastSeenAt: at },
    ],
    tasks: [], reminders: [], connectors: [], models: [], projects: [],
  };
  const client = {
    snapshot: vi.fn(async () => structuredClone(snapshot)),
    updatePeer: vi.fn(async (assistantId: string, update: AssistantPeerUpdate) => {
      snapshot = { ...snapshot, peers: snapshot.peers.flatMap((peer) => {
        if (peer.assistantId !== assistantId || peer.kind !== update.kind || peer.openid !== update.openid) return [peer];
        return update.status === 'removed' ? [] : [{ ...peer, status: update.status }];
      }) };
      return structuredClone(snapshot);
    }),
  };
  const service = { client: client as unknown as AssistantsClient, store: createAssistantsStore(client) };
  // Pending sources arrive through the existing refresh, without rendering the information panel.
  service.store.publish({ ...snapshot, peers: [] });
  const openConversation = vi.fn(async () => true);
  const page = (assistantId: string) => <StrictMode><AssistantConversation service={service} threadId={`${assistantId}-shared`}
    openConversation={openConversation} renderToolbar={() => null} renderConversation={(_starter, _thinking, _info, _navigation, header) => header}
    ui={{ Avatar: () => null, AvatarField: () => null, ModelPicker: () => null, ProjectIcon: () => null }} translate={t} /></StrictMode>;
  const view = render(page('owner'));
  return { client, service, openConversation, open: (assistantId: string) => view.rerender(page(assistantId)) };
}
