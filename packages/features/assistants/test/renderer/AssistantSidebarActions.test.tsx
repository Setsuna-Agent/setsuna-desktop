// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { AssistantsSnapshot } from '../../src/contracts/index.js';
import { AssistantInfoPanel } from '../../src/renderer/AssistantInfoPanel.js';
import type { AssistantsClient } from '../../src/renderer/client.js';
import { assistantsMessages } from '../../src/renderer/messages.js';
import { createAssistantsStore, useAssistantsSnapshot } from '../../src/renderer/store.js';

afterEach(cleanup);
const t: RendererTranslate = (key) => assistantsMessages.messages['zh-CN'][key] ?? key;

it('任务置顶或取消置顶不切换对话，重命名失败及刷新后保留任务草稿', async () => {
  const f = mountPanel();
  await menu('任务 first', '置顶');
  await waitFor(() => expect(f.service.store.getSnapshot()?.tasks.find((item) => item.id === 'first')?.pinned).toBe(true));
  await menu('任务 first', '取消置顶');
  await waitFor(() => expect(f.service.store.getSnapshot()?.tasks.find((item) => item.id === 'first')?.pinned).toBe(false));
  expect(f.client.updateSidebarEntry).toHaveBeenNthCalledWith(1, { assistantId: 'owner', kind: 'task', entryId: 'first' }, { pinned: true });
  expect(f.client.updateSidebarEntry).toHaveBeenNthCalledWith(2, { assistantId: 'owner', kind: 'task', entryId: 'first' }, { pinned: false });

  vi.mocked(f.client.updateSidebarEntry).mockRejectedValueOnce(new Error('保存失败'));
  await menu('任务 first', '重命名');
  const title = screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement;
  fireEvent.change(title, { target: { value: '保留我的修改' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('保存失败');
  await act(() => f.service.store.refresh());
  expect(title.value).toBe('保留我的修改');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.client.updateSidebarEntry).toHaveBeenLastCalledWith({ assistantId: 'owner', kind: 'task', entryId: 'first' }, { title: '保留我的修改' });
  expect(f.service.store.getSnapshot()?.tasks.find((item) => item.id === 'first')?.title).toBe('保留我的修改');
  expect(f.openTask).not.toHaveBeenCalled();
});

it('删除取消后不执行；从信息面板删除任务只删除目标条目，不导航到其他对话', async () => {
  const f = mountPanel();
  await menu('任务 second', '删除');
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }));
  expect(f.client.deleteSidebarEntry).not.toHaveBeenCalled();

  await menu('任务 second', '删除');
  await confirm('删除');
  await waitFor(() => expect(f.service.store.getSnapshot()?.tasks.some((item) => item.id === 'second')).toBe(false));
  await menu('任务 first', '删除');
  await confirm('删除');
  await waitFor(() => expect(f.service.store.getSnapshot()?.tasks).toEqual([]));
  expect(vi.mocked(f.client.deleteSidebarEntry).mock.calls).toEqual([
    [{ assistantId: 'owner', kind: 'task', entryId: 'second' }],
    [{ assistantId: 'owner', kind: 'task', entryId: 'first' }],
  ]);
  expect(f.openTask).not.toHaveBeenCalled();
});

it('未执行的提醒可从详情删除，失败后保留入口重试且不删除同 ID 的项目任务', async () => {
  const f = mountPanel();
  vi.mocked(f.client.deleteSidebarEntry).mockRejectedValueOnce(new Error('删除失败'));
  fireEvent.click(await screen.findByRole('button', { name: '早安提醒' }));
  const removeFromDetails = async () => {
    fireEvent.click(within(await screen.findByRole('dialog', { name: '早安提醒' })).getByRole('button', { name: '删除' }));
    await confirm('删除');
  };
  await removeFromDetails();
  await screen.findByText('删除失败');
  expect(f.service.store.getSnapshot()?.reminders.map((item) => item.id)).toEqual(['first']);
  await act(() => f.service.store.refresh());
  await removeFromDetails();
  await waitFor(() => expect(f.service.store.getSnapshot()?.reminders).toEqual([]));
  expect(vi.mocked(f.client.deleteSidebarEntry).mock.calls).toEqual([
    [{ assistantId: 'owner', kind: 'reminder', entryId: 'first' }],
    [{ assistantId: 'owner', kind: 'reminder', entryId: 'first' }],
  ]);
  expect(f.service.store.getSnapshot()?.tasks.map((item) => item.id)).toEqual(['first', 'second']);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(f.openTask).not.toHaveBeenCalled();
  expect(f.openReminder).not.toHaveBeenCalled();
});

async function menu(title: string, action: string) {
  const target = await screen.findByRole('button', { name: title });
  await waitFor(() => expect(target.hasAttribute('disabled')).toBe(false));
  fireEvent.contextMenu(target, { clientX: 40, clientY: 60 });
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
}

async function confirm(label: string) {
  fireEvent.click(within(await screen.findByRole('dialog', { name: /删除/ })).getByRole('button', { name: label }));
}

function mountPanel() {
  const at = '2026-10-01T00:00:00Z';
  let snapshot: AssistantsSnapshot = {
    assistants: [{ id: 'owner', name: 'owner', personality: '', projectIds: [], createdAt: at, updatedAt: at }],
    conversations: [],
    tasks: ['first', 'second'].map((id, index) => ({ id, title: `任务 ${id}`, assistantId: 'owner', origin: { threadId: 'local' },
      projectId: 'project', workThreadId: 'work', workspaceKey: 'project', instructions: '完成工作', status: 'completed',
      requests: [], turnId: `turn-${id}`, createdAt: at, updatedAt: index ? '2026-10-01T01:00:00Z' : at })),
    reminders: [{ id: 'first', assistantId: 'owner', title: '早安提醒', instructions: '早安',
      schedule: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' },
      status: 'active', nextRunAt: '2026-10-02T01:00:00Z', createdAt: at, updatedAt: at }],
    peers: [], connectors: [], projects: [], models: [],
  };
  const client: AssistantsClient = {
    snapshot: vi.fn(async () => structuredClone(snapshot)),
    updateSidebarEntry: vi.fn(async (target, patch) => {
      snapshot = { ...snapshot, tasks: snapshot.tasks.map((item) => item.id === target.entryId ? { ...item, ...patch } : item) };
      return { ok: true };
    }),
    deleteSidebarEntry: vi.fn(async (target) => {
      snapshot = target.kind === 'reminder'
        ? { ...snapshot, reminders: snapshot.reminders.filter((item) => item.id !== target.entryId) }
        : { ...snapshot, tasks: snapshot.tasks.filter((item) => item.id !== target.entryId) };
      return { ok: true };
    }),
    delete: vi.fn(async (id) => {
      snapshot = { ...snapshot, assistants: snapshot.assistants.filter((item) => item.id !== id),
        conversations: snapshot.conversations.filter((item) => item.assistantId !== id), tasks: snapshot.tasks.filter((item) => item.assistantId !== id) };
      return { deleted: true };
    }),
    create: vi.fn(), update: vi.fn(), openConversation: vi.fn(), revealQqSecret: vi.fn(), setQqSecret: vi.fn(), updatePeer: vi.fn(),
  };
  const service = { client, store: createAssistantsStore(client) };
  service.store.publish(structuredClone(snapshot));
  const openTask = vi.fn();
  const openReminder = vi.fn();
  function App() {
    const current = useAssistantsSnapshot(service.store)!;
    return <AssistantInfoPanel service={service} snapshot={current} assistant={current.assistants[0]!}
      ui={{ Avatar: () => null, AvatarField: () => null, ModelPicker: () => null, ProjectIcon: () => null }}
      onOpenTask={openTask} onOpenReminder={openReminder} translate={t} />;
  }
  render(<StrictMode><ConfirmationProvider><App /></ConfirmationProvider></StrictMode>);
  return { client, service, openTask, openReminder };
}
