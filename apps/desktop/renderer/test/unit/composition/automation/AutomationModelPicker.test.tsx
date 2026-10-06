// @vitest-environment happy-dom
import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { AutomationPage, type AutomationClient } from '@setsuna-desktop/feature-automation/renderer';
import type { AutomationTask } from '@setsuna-desktop/feature-automation/contracts';
import { useModelProviderSnapshot } from '@setsuna-desktop/feature-model-provider/renderer';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { AutomationModelPicker } from '../../../../src/composition/automation/AutomationModelPicker.js';

vi.mock('@setsuna-desktop/feature-model-provider/renderer', async (importOriginal) => ({
  ...await importOriginal<typeof import('@setsuna-desktop/feature-model-provider/renderer')>(),
  useModelProviderSnapshot: vi.fn(),
}));
vi.mock('../../../../src/shared/i18n/I18nProvider.js', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../../../src/shared/branding/BrandIconMark.js', () => ({ BrandIconMark: () => <span /> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('searches by provider and model code, saves the exact model, and clears an incompatible effort', async () => {
  const { client, user } = await fixture();
  let editor = await openEditor(user);
  await user.click(within(editor).getByRole('button', { name: 'feature.automation.model' }));
  const search = await screen.findByRole('textbox', { name: 'chat.model.search' });
  await waitFor(() => expect(document.activeElement).toBe(search));
  await user.type(search, ' SECOND SERVICE ');
  await user.keyboard('{ArrowDown}{ArrowUp}');
  expect(document.activeElement).toBe(search);
  await user.clear(search);
  await user.type(search, ' BETA-CODE ');
  fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
  expect(client.update).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await user.click(within(editor).getByRole('button', { name: 'feature.automation.save' }));
  await waitFor(() => expect(client.update).toHaveBeenCalledWith('task', expect.objectContaining({
    modelSelection: { providerId: 'provider-b', modelId: 'alternative' },
  })));
  expect(vi.mocked(client.update).mock.lastCall?.[1]).not.toHaveProperty('thinkingEffort');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  editor = await openEditor(user);
  await user.click(within(editor).getByRole('combobox', { name: 'feature.automation.effort' }));
  await user.click(await screen.findByRole('option', { name: 'max' }));
  await user.click(within(editor).getByRole('button', { name: 'feature.automation.save' }));
  await waitFor(() => expect(client.update).toHaveBeenLastCalledWith('task', expect.objectContaining({
    modelSelection: { providerId: 'provider-b', modelId: 'alternative' }, thinkingEffort: 'max',
  })));
});

it('keeps an unmatched search editable and can reset the task to the current conversation model', async () => {
  const { client, user } = await fixture();
  const editor = await openEditor(user);
  const trigger = within(editor).getByRole('button', { name: 'feature.automation.model' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const search = await screen.findByRole('textbox', { name: 'chat.model.search' });
  await waitFor(() => expect(document.activeElement).toBe(search));
  await user.type(search, 'missing-model');
  await user.keyboard('{ArrowDown}{Tab}{Enter}');
  expect(document.activeElement).toBe(search);
  expect(client.update).not.toHaveBeenCalled();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await user.click(trigger);
  await user.click(await screen.findByRole('menuitem', { name: 'feature.automation.defaultModel' }));
  await user.click(within(editor).getByRole('button', { name: 'feature.automation.save' }));
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce());
  expect(vi.mocked(client.update).mock.lastCall?.[1]).not.toHaveProperty('modelSelection');
  expect(vi.mocked(client.update).mock.lastCall?.[1]).not.toHaveProperty('thinkingEffort');
});

it('allows wheel scrolling in the task model menu while keeping the background locked', async () => {
  const { user } = await fixture();
  const editor = await openEditor(user);
  await user.click(within(editor).getByRole('button', { name: 'feature.automation.model' }));
  const menu = await screen.findByRole('menu');
  const list = menu.querySelector<HTMLElement>('.model-picker-menu__list')!;
  // happy-dom has no layout; simulate a list with room to scroll in either direction.
  list.style.overflowY = 'auto';
  Object.defineProperties(list, {
    clientHeight: { value: 200 },
    scrollHeight: { value: 800 },
    scrollTop: { value: 100, writable: true },
  });
  const row = within(menu).getByRole('menuitem', { name: 'Beta model' });
  expect(fireEvent.wheel(row, { deltaY: 40 })).toBe(true);
  expect(fireEvent.wheel(row, { deltaY: -40 })).toBe(true);
  expect(fireEvent.wheel(document.body, { deltaY: 40 })).toBe(false);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(screen.getByRole('dialog')).toBe(editor);
});

async function fixture() {
  const providers: ProviderConfigState[] = [
    provider('provider-a', 'First service', 'Alpha model', 'alpha-code', ['low']),
    provider('provider-b', 'Second service', 'Beta model', 'beta-code', ['max']),
  ];
  providers[0]!.models.unshift({ ...providers[0]!.models[0]!, id: 'default', name: 'Default model', code: 'default-code', enabled: true, thinkingEfforts: ['high'] });
  vi.mocked(useModelProviderSnapshot).mockReturnValue({
    error: null, loading: false, catalog: null, refreshingCatalogProviderId: null, catalogError: null, proxyServers: [],
    state: { activeProviderId: 'provider-a', providers },
  });
  const at = '2026-09-30T00:00:00Z';
  let task: AutomationTask = {
    id: 'task', title: 'Task', prompt: 'Summarize results', conversationThreadId: 'setup',
    schedule: { kind: 'interval', minutes: 60 }, newChat: false, status: 'active', nextRunAt: at,
    createdAt: at, updatedAt: at, runs: [], modelSelection: { providerId: 'provider-a', modelId: 'default' }, thinkingEffort: 'high',
  };
  const models = providers.flatMap((provider) => provider.models.map((model) => ({
    providerId: provider.id, modelId: model.id, name: model.name, thinkingEfforts: model.thinkingEfforts,
  })));
  const client: AutomationClient = {
    snapshot: vi.fn(async () => ({ tasks: [task], models, projects: [] })),
    update: vi.fn(async (_id, draft) => {
      task = { ...task, ...draft, modelSelection: draft.modelSelection, thinkingEffort: draft.thinkingEffort };
      return task;
    }),
    createConversation: vi.fn(), create: vi.fn(), setStatus: vi.fn(), run: vi.fn(), delete: vi.fn(),
  };
  const openConversation = vi.fn(async () => true);
  render(<ConfirmationProvider><AutomationPage client={client} threadId="setup" openConversation={openConversation}
    onSelectStarterPrompt={vi.fn()} ModelPicker={AutomationModelPicker} renderConversation={() => null}
    renderToolbar={() => null} translate={(key) => key} locale="en-US" /></ConfirmationProvider>);
  await waitFor(() => expect(openConversation).toHaveBeenCalledWith('setup'));
  return { client, user: userEvent.setup({ skipHover: true }) };
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  const task = await screen.findByRole('button', { name: /^Task/u });
  await waitFor(() => expect(task.hasAttribute('disabled')).toBe(false));
  fireEvent.contextMenu(task, { clientX: 40, clientY: 60 });
  await user.click(await screen.findByRole('menuitem', { name: 'feature.automation.edit' }));
  const editor = await screen.findByRole('dialog');
  await user.click(within(editor).getByText('feature.automation.advanced'));
  return editor;
}

function provider(id: string, name: string, modelName: string, code: string, thinkingEfforts: string[]): ProviderConfigState {
  return {
    id, name, provider: 'openai-compatible', baseUrl: 'https://example.test/v1', enabled: true, apiKeySet: true, apiKeyPreview: '***',
    models: [{ id: 'alternative', name: modelName, code, enabled: false, maxOutputTokens: 1_000, thinkingEnabled: true, thinkingEfforts }],
  };
}
