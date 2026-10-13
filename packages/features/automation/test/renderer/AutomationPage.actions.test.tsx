// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { AutomationTask } from '../../src/contracts/index.js';
import { AutomationPage } from '../../src/renderer/AutomationPage.js';
import type { AutomationClient } from '../../src/renderer/client.js';
import { automationMessages } from '../../src/renderer/messages.js';
import { TaskEditor } from '../../src/renderer/TaskEditor.js';

afterEach(cleanup);
const t: RendererTranslate = (key) => automationMessages.messages['en-US'][key] ?? key;

it('locks the submitted task draft, retains it on failure, and allows a corrected retry', async () => {
  const user = userEvent.setup();
  let rejectSave!: (reason: Error) => void;
  const create = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }))
    .mockResolvedValueOnce({ id: 'saved' });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<TaskEditor threadId="draft" client={{ create } as unknown as AutomationClient} models={[]} projects={[]}
    ModelPicker={() => null} translate={t} onClose={onClose} onSaved={onSaved} />);
  const title = screen.getByRole('textbox', { name: t('feature.automation.taskTitle') }) as HTMLInputElement;
  const prompt = screen.getByRole('textbox', { name: t('feature.automation.prompt') }) as HTMLTextAreaElement;
  await user.type(title, 'Task draft');
  await user.type(prompt, 'Original prompt');
  await user.click(screen.getByRole('button', { name: t('feature.automation.create') }));
  fireEvent.submit(title.form!);
  await user.type(prompt, ' should not be added');
  await user.keyboard('{Escape}');
  expect(create).toHaveBeenCalledOnce();
  expect(prompt.value).toBe('Original prompt');
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => rejectSave(new Error('Save failed')));
  expect(screen.getByRole('alert').textContent).toBe('Save failed');
  expect(title.value).toBe('Task draft');
  await user.clear(prompt);
  await user.type(prompt, 'Corrected prompt');
  await user.click(screen.getByRole('button', { name: t('feature.automation.create') }));
  expect(create).toHaveBeenLastCalledWith('draft', expect.objectContaining({ title: 'Task draft', prompt: 'Corrected prompt' }));
  expect(onSaved).toHaveBeenCalledExactlyOnceWith({ id: 'saved' });
  expect(onClose).toHaveBeenCalledOnce();
});

it.each(['edit', 'status', 'run', 'delete'] as const)('applies the context-menu %s action to the clicked task without changing the conversation', async (action) => {
  const at = '2026-09-30T00:00:00Z';
  const tasks: AutomationTask[] = ['A', 'B'].map((id) => ({
    id, title: `Task ${id}`, prompt: `Prompt ${id}`, schedule: { kind: 'interval', minutes: 60 },
    newChat: false, conversationThreadId: `thread_${id}`, status: 'active', nextRunAt: at,
    projectId: 'iriya',
    createdAt: at, updatedAt: at, runs: [],
  }));
  const targetTask = tasks[1]!;
  const client: AutomationClient = {
    snapshot: vi.fn(async () => ({ tasks, models: [], projects: [{ id: 'iriya', name: 'iriya' }] })), createConversation: vi.fn(), create: vi.fn(),
    update: vi.fn(async () => targetTask), setStatus: vi.fn(async () => targetTask),
    run: vi.fn(async () => targetTask), delete: vi.fn(async () => ({ deleted: true })),
  };
  const openConversation = vi.fn(async () => true);
  render(<ConfirmationProvider><AutomationPage client={client} threadId="thread_A" openConversation={openConversation}
    onSelectStarterPrompt={vi.fn()} ModelPicker={() => null}
    renderConversation={() => null} renderToolbar={() => null} translate={t} locale="en-US" /></ConfirmationProvider>);
  await waitFor(() => expect(openConversation).toHaveBeenCalledWith('thread_A'));
  const target = await screen.findByRole('button', { name: /^Task B/u });
  await waitFor(() => expect(target.hasAttribute('disabled')).toBe(false));
  fireEvent.contextMenu(target, { clientX: 40, clientY: 60 });
  const label = t(`feature.automation.${action === 'status' ? 'pause' : action}`);
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
  if (action === 'edit') {
    const editor = await screen.findByRole('dialog');
    fireEvent.change(within(editor).getByRole('textbox', { name: t('feature.automation.prompt') }), { target: { value: 'Updated B' } });
    fireEvent.click(within(editor).getByRole('button', { name: t('feature.automation.save') }));
    await waitFor(() => expect(client.update).toHaveBeenCalledWith('B', expect.objectContaining({ prompt: 'Updated B', projectId: 'iriya' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  } else if (action === 'delete') {
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: label }));
    await waitFor(() => expect(client.delete).toHaveBeenCalledWith('B'));
  } else if (action === 'status') {
    await waitFor(() => expect(client.setStatus).toHaveBeenCalledWith('B', 'paused'));
  } else {
    await waitFor(() => expect(client.run).toHaveBeenCalledWith('B'));
  }
  await waitFor(() => expect(client.snapshot).toHaveBeenCalledTimes(2));
  expect(openConversation).toHaveBeenCalledExactlyOnceWith('thread_A');
});

it.each(['chat', 'form'] as const)('creates a task through the %s menu path while another task is selected', async (method) => {
  const user = userEvent.setup({ skipHover: true });
  const at = '2026-09-30T00:00:00Z';
  const existing: AutomationTask = {
    id: 'existing', title: 'Existing task', prompt: 'Existing prompt',
    schedule: { kind: 'interval', minutes: 60 }, newChat: false,
    conversationThreadId: 'existing_thread', status: 'active', nextRunAt: at,
    createdAt: at, updatedAt: at, runs: [],
  };
  const client: AutomationClient = {
    snapshot: vi.fn(async () => ({ tasks: [existing], models: [], projects: [] })),
    createConversation: vi.fn(async () => ({ threadId: 'setup_draft' })),
    create: vi.fn(async () => ({ ...existing, id: 'new', conversationThreadId: 'setup_draft' })),
    update: vi.fn(), setStatus: vi.fn(), run: vi.fn(), delete: vi.fn(),
  };
  const openConversation = vi.fn(async () => true);
  render(<ConfirmationProvider><AutomationPage client={client} threadId="existing_thread" openConversation={openConversation}
    onSelectStarterPrompt={vi.fn()} ModelPicker={() => null}
    renderConversation={() => null} renderToolbar={() => null} translate={t} locale="en-US" /></ConfirmationProvider>);
  await waitFor(() => expect(openConversation).toHaveBeenCalledWith('existing_thread'));
  const create = screen.getByRole('button', { name: t('feature.automation.create') });
  await waitFor(() => expect(create.hasAttribute('disabled')).toBe(false));
  await user.click(create);
  await user.click(await screen.findByRole('menuitem', { name: t(method === 'chat' ? 'feature.automation.createChat' : 'feature.automation.createForm') }));
  if (method === 'chat') {
    await waitFor(() => expect(openConversation).toHaveBeenCalledWith('setup_draft'));
    expect(client.create).not.toHaveBeenCalled();
  } else {
    const editor = await screen.findByRole('dialog');
    fireEvent.change(within(editor).getByRole('textbox', { name: t('feature.automation.taskTitle') }), { target: { value: 'New task' } });
    fireEvent.change(within(editor).getByRole('textbox', { name: t('feature.automation.prompt') }), { target: { value: 'New prompt' } });
    await user.click(within(editor).getByRole('button', { name: t('feature.automation.create') }));
    await waitFor(() => expect(client.create).toHaveBeenCalledWith('setup_draft', expect.objectContaining({ title: 'New task', prompt: 'New prompt' })));
    expect(openConversation).toHaveBeenCalledExactlyOnceWith('existing_thread');
  }
  expect(client.createConversation).toHaveBeenCalledOnce();
  expect(client.update).not.toHaveBeenCalled();
});
