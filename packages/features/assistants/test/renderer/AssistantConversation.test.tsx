// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import type { ChatTurnNavigationRequest } from '@setsuna-desktop/renderer-contracts/chat';
import type { AssistantsSnapshot } from '../../src/contracts/index.js';
import { AssistantConversation } from '../../src/renderer/AssistantConversation.js';
import type { AssistantsClient } from '../../src/renderer/client.js';
import { createAssistantsStore } from '../../src/renderer/store.js';

afterEach(cleanup);

it('旧 QQ 入口恢复到原助理的共享对话，轮询和 StrictMode 不重复导航', async () => {
  const at = '2026-10-01T00:00:00Z';
  const snapshot: AssistantsSnapshot = {
    assistants: ['first', 'owner'].map((id) => ({ id, name: id, personality: '', projectIds: [], createdAt: at, updatedAt: at })),
    conversations: ['first', 'owner'].map((id) => ({ assistantId: id, threadId: `${id}-shared`, source: 'shared',
      title: id, createdAt: at, updatedAt: at, ...(id === 'owner' ? { previousThreadIds: ['old-qq'] } : {}) })),
    tasks: [], reminders: [], peers: [], connectors: [], models: [], projects: [],
  };
  const client = { snapshot: vi.fn(async () => snapshot) } as unknown as AssistantsClient;
  const service = { client, store: createAssistantsStore(client) };
  service.store.publish(snapshot);
  const openConversation = vi.fn(async () => true);
  const page = (threadId: string) => <StrictMode><AssistantConversation service={service} threadId={threadId}
    openConversation={openConversation} renderConversation={() => null} renderToolbar={() => null} translate={(key) => key}
    ui={{ Avatar: () => null, AvatarField: () => null, ModelPicker: () => null }} /></StrictMode>;
  const { rerender } = render(page('old-qq'));
  await waitFor(() => expect(openConversation).toHaveBeenCalledExactlyOnceWith('owner-shared'));
  rerender(page('owner-shared'));
  await act(() => service.store.refresh());
  expect(openConversation).toHaveBeenCalledExactlyOnceWith('owner-shared');
});

it('信息面板中的提醒定位到同一聊天的执行轮次，重复点击仍定位；项目任务继续打开项目对话', async () => {
  const at = '2026-10-01T00:00:00Z';
  const snapshot: AssistantsSnapshot = {
    assistants: [{ id: 'owner', name: '助理', personality: '', projectIds: [], createdAt: at, updatedAt: at }],
    conversations: [{ assistantId: 'owner', threadId: 'shared', source: 'shared', title: '助理', createdAt: at, updatedAt: at }],
    reminders: [{ id: 'same_id', assistantId: 'owner', title: '早安提醒', instructions: '早安', schedule: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' },
      status: 'active', nextRunAt: '2026-10-02T01:00:00Z', createdAt: at, updatedAt: at,
      lastRun: { id: 'receipt', threadId: 'shared', turnId: 'greeting_turn', instructions: '早安', scheduledFor: at } }],
    tasks: [{ id: 'same_id', assistantId: 'owner', title: '项目工作', origin: { threadId: 'shared' }, projectId: 'project',
      workThreadId: 'work', workspaceKey: 'project', instructions: '完成工作', status: 'completed', requests: [], createdAt: at, updatedAt: at }],
    peers: [], connectors: [], models: [], projects: [],
  };
  const client = { snapshot: vi.fn(async () => snapshot) } as unknown as AssistantsClient;
  const service = { client, store: createAssistantsStore(client) };
  service.store.publish(snapshot);
  const openConversation = vi.fn(async () => true);
  let navigation: ChatTurnNavigationRequest | undefined;
  render(<ConfirmationProvider><AssistantConversation service={service} threadId="shared" openConversation={openConversation}
    renderConversation={(_starter, _thinking, info, request) => { navigation = request; return info; }}
    renderToolbar={() => null} translate={(key) => key}
    ui={{ Avatar: () => null, AvatarField: () => null, ModelPicker: () => null }} /></ConfirmationProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '早安提醒' }));
  expect(navigation).toEqual({ requestId: 1, threadId: 'shared', turnId: 'greeting_turn' });
  fireEvent.click(screen.getByRole('button', { name: '早安提醒' }));
  expect(navigation).toEqual({ requestId: 2, threadId: 'shared', turnId: 'greeting_turn' });
  expect(openConversation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '项目工作' }));
  expect(openConversation).toHaveBeenCalledExactlyOnceWith('work');
});
