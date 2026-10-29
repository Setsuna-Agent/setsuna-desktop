// @vitest-environment happy-dom
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultCollaborationAgentSettings, type CollaborationSettingsState } from '../../src/contracts/index.js';
import type { CollaborationClient } from '../../src/renderer/client.js';
import { CollaborationSettingsView } from '../../src/renderer/CollaborationSettingsView.js';
import { collaborationMessages } from '../../src/renderer/messages.js';

afterEach(cleanup);
const key = (suffix: string) => `feature.collaboration.settings.${suffix}`;
const ui: Partial<SettingsViewUi> = {
  Section: ({ children }) => <div>{children}</div>,
  Group: ({ title, children }) => <section><h2>{title}</h2>{children}</section>,
  Row: ({ label, children }) => <div>{label}{children}</div>,
  NavigationRow: ({ label, disabled, onClick }) => <button disabled={disabled} onClick={onClick}>{label}</button>,
  ModelPicker: ({ models, value, onChange, defaultLabel, ...props }) => (
    <select aria-label={props['aria-label']} disabled={props.disabled} value={value?.modelId ?? ''} onChange={(event) => {
      const model = models.find((model) => model.modelId === event.target.value);
      onChange(model ? { providerId: model.providerId, modelId: model.modelId } : null);
    }}>
      <option value="">{defaultLabel}</option>
      {models.map((model) => <option key={model.modelId} value={model.modelId}>{model.modelName}</option>)}
    </select>
  ),
  SelectField: ({ onValueChange, children, ...props }) => <select aria-label={props['aria-label']} value={props.value}
    disabled={props.disabled} onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
  TextField: (props) => <input {...props} />,
  TextArea: (props) => <textarea {...props} />,
  Button: ({ variant: _variant, icon: _icon, type = 'button', ...props }) => <button type={type} {...props} />,
  Dialog: ({ title, children, footer }) => <div role="dialog" aria-label={String(title)}>{children}{footer}</div>,
  Toast: ({ message }) => <p role="alert">{message}</p>,
};

function initialState(): CollaborationSettingsState {
  return { settings: defaultCollaborationAgentSettings(), revision: 1, availableModels: [{
    providerId: 'provider', providerName: 'Provider', modelId: 'fast', modelName: 'Fast', modelCode: 'fast', reasoningEfforts: ['low', 'high'],
  }] };
}

it('updates inherited role text with the UI language without freezing it on save or translating user edits', async () => {
  let state = initialState();
  const client = { readSettings: async () => state, updateSettings: vi.fn<CollaborationClient['updateSettings']>(async (input) => {
    state = { ...state, settings: input.settings, revision: state.revision + 1 };
    return state;
  }) };
  const page = (locale: string) => <CollaborationSettingsView ui={ui as SettingsViewUi} client={client}
    translate={(key) => collaborationMessages.messages[locale]?.[key] ?? key} />;
  const view = render(page('zh-CN'));
  fireEvent.click(await view.findByRole('button', { name: 'worker' }));
  expect((view.getByLabelText('指令') as HTMLTextAreaElement).value).toContain('在约定的文件分工范围内');
  view.rerender(page('en-US'));
  expect((view.getByLabelText('Instructions') as HTMLTextAreaElement).value).toContain('Implement the assigned change');
  fireEvent.change(view.getByRole('combobox', { name: 'Model' }), { target: { value: 'fast' } });
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(state.settings.roles.find((role) => role.name === 'worker')).toMatchObject({ description: null, instructions: null, model: { modelId: 'fast' } });
  fireEvent.click(view.getByRole('button', { name: 'worker' }));
  fireEvent.change(view.getByLabelText('Instructions'), { target: { value: 'My custom English instructions' } });
  view.rerender(page('zh-CN'));
  expect((view.getByLabelText('指令') as HTMLTextAreaElement).value).toBe('My custom English instructions');
  expect((view.getByLabelText('说明') as HTMLInputElement).value).toBe('实现并验证范围明确的改动');
  fireEvent.click(view.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(state.settings.roles.find((role) => role.name === 'worker')?.instructions).toBe('My custom English instructions');
});

it('saves default choices immediately and commits a role only after its dialog is saved', async () => {
  let state = initialState();
  const update = vi.fn<CollaborationClient['updateSettings']>(async (input) => {
    expect(input.expectedRevision).toBe(state.revision);
    state = { ...state, settings: input.settings, revision: state.revision + 1 };
    return state;
  });
  const view = render(<CollaborationSettingsView ui={ui as SettingsViewUi} translate={(key) => key}
    client={{ readSettings: async () => state, updateSettings: update }} />);
  fireEvent.change(await view.findByRole('combobox', { name: key('model') }), { target: { value: 'fast' } });
  await waitFor(() => expect(state.settings.model).toEqual({ providerId: 'provider', modelId: 'fast' }));
  await waitFor(() => expect((view.getByRole('button', { name: 'worker' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole('button', { name: 'worker' }));
  let dialog = within(view.getByRole('dialog', { name: key('edit') }));
  fireEvent.click(dialog.getByRole('button', { name: 'feature.collaboration.avatar.change' }));
  fireEvent.click(view.getAllByRole('button', { name: 'feature.collaboration.avatar.preset' })[9]!);
  fireEvent.click(dialog.getByRole('button', { name: 'feature.collaboration.avatar.change' }));
  fireEvent.change(dialog.getByLabelText(key('instructions')), { target: { value: 'Discard this edit' } });
  fireEvent.click(dialog.getByRole('button', { name: key('cancel') }));
  expect(update).toHaveBeenCalledTimes(1);
  expect(state.settings.roles.find((role) => role.name === 'worker')?.avatar).toBeUndefined();
  fireEvent.click(view.getByRole('button', { name: 'worker' }));
  dialog = within(view.getByRole('dialog', { name: key('edit') }));
  expect((dialog.getByLabelText(key('instructions')) as HTMLTextAreaElement).value).not.toBe('Discard this edit');
  fireEvent.click(dialog.getByRole('button', { name: 'feature.collaboration.avatar.change' }));
  fireEvent.click(view.getAllByRole('button', { name: 'feature.collaboration.avatar.preset' })[9]!);
  fireEvent.click(dialog.getByRole('button', { name: 'feature.collaboration.avatar.change' }));
  fireEvent.change(dialog.getByLabelText(key('instructions')), { target: { value: 'Run the assigned checks' } });
  fireEvent.click(dialog.getByRole('button', { name: key('save') }));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(state.settings.model?.modelId).toBe('fast');
  expect(state.settings.roles.find((role) => role.name === 'worker')?.instructions).toBe('Run the assigned checks');
  expect(state.settings.roles.find((role) => role.name === 'worker')?.avatar).toEqual({ type: 'preset', key: 'gem' });
  expect(state.settings.roles.filter((role) => role.name !== 'worker')).toEqual(defaultCollaborationAgentSettings().roles.filter((role) => role.name !== 'worker'));
  expect(state.revision).toBe(3);
});

it('saves an uploaded avatar and can reset it without changing the other agent fields', async () => {
  let state = initialState();
  const view = render(<CollaborationSettingsView ui={ui as SettingsViewUi} translate={(key) => key}
    client={{ readSettings: async () => state, updateSettings: async (input) => {
      state = { ...state, settings: input.settings, revision: state.revision + 1 };
      return state;
    } }} />);
  fireEvent.click(await view.findByRole('button', { name: 'worker' }));
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'avatar.png', { type: 'image/png' })] } });
  await waitFor(() => expect((view.getByRole('button', { name: key('save') }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole('button', { name: key('save') }));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(state.settings.roles.find((role) => role.name === 'worker')?.avatar).toEqual({ type: 'custom', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
  fireEvent.click(view.getByRole('button', { name: 'worker' }));
  fireEvent.click(view.getByRole('button', { name: 'feature.collaboration.avatar.change' }));
  fireEvent.click(view.getByRole('button', { name: 'feature.collaboration.avatar.reset' }));
  fireEvent.click(view.getByRole('button', { name: key('save') }));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(state.settings.roles).toEqual(defaultCollaborationAgentSettings().roles);
});

it('retains a new role draft on failure and retries against refreshed settings without overwriting unrelated changes', async () => {
  let state = initialState();
  const update = vi.fn<CollaborationClient['updateSettings']>()
    .mockImplementationOnce(async () => {
      state = { ...state, revision: 2, settings: { ...state.settings, reasoningEffort: 'low' } };
      throw new Error('Settings changed');
    })
    .mockImplementation(async (input) => {
      expect(input.expectedRevision).toBe(2);
      state = { ...state, settings: input.settings, revision: 3 };
      return state;
    });
  const view = render(<CollaborationSettingsView ui={ui as SettingsViewUi} translate={(key) => key}
    client={{ readSettings: async () => state, updateSettings: update }} />);
  await waitFor(() => expect((view.getByRole('button', { name: key('add') }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole('button', { name: key('add') }));
  const dialog = within(view.getByRole('dialog', { name: key('add') }));
  fireEvent.change(dialog.getByLabelText(key('name')), { target: { value: 'reviewer' } });
  fireEvent.change(dialog.getByLabelText(key('instructions')), { target: { value: 'Review the patch' } });
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: key('save') }));
  await view.findByRole('alert');
  await waitFor(() => expect((dialog.getByRole('button', { name: key('save') }) as HTMLButtonElement).disabled).toBe(false));
  expect((dialog.getByLabelText(key('instructions')) as HTMLTextAreaElement).value).toBe('Review the patch');
  expect(state.settings.roles.some((role) => role.name === 'reviewer')).toBe(false);
  fireEvent.click(dialog.getByRole('button', { name: key('save') }));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(state.settings.reasoningEffort).toBe('low');
  expect(state.settings.roles.at(-1)).toMatchObject({ name: 'reviewer', instructions: 'Review the patch' });
});

it('deletes only the opened role after confirmation, leaving cancellation and the default role intact', async () => {
  let state = initialState();
  const update = vi.fn<CollaborationClient['updateSettings']>(async (input) => {
    state = { ...state, settings: input.settings, revision: state.revision + 1 };
    return state;
  });
  const view = render(<CollaborationSettingsView ui={ui as SettingsViewUi} translate={(key) => key}
    client={{ readSettings: async () => state, updateSettings: update }} />);
  fireEvent.click(await view.findByRole('button', { name: 'worker' }));
  const editor = within(view.getByRole('dialog', { name: key('edit') }));
  fireEvent.click(editor.getByRole('button', { name: key('remove') }));
  let confirmation = within(view.getByRole('dialog', { name: key('removeConfirm') }));
  fireEvent.click(confirmation.getByRole('button', { name: key('cancel') }));
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(editor.getByRole('button', { name: key('remove') }));
  confirmation = within(view.getByRole('dialog', { name: key('removeConfirm') }));
  fireEvent.click(confirmation.getByRole('button', { name: key('remove') }));
  await waitFor(() => expect(view.queryByRole('dialog', { name: key('edit') })).toBeNull());
  expect(state.settings.roles.map((role) => role.name)).toEqual(['default', 'explorer']);
  expect(update).toHaveBeenCalledTimes(1);
});
