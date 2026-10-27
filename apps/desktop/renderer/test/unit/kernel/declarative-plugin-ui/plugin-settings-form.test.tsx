// @vitest-environment happy-dom

import type { RuntimePluginUiActionInput, RuntimePluginUiTreeContribution } from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeclarativePluginUiView } from '../../../../src/kernel/declarative-plugin-ui/DeclarativePluginUiView.js';

afterEach(cleanup);

it('keeps secret drafts separate from ordinary values, retries failed saves, and clears only on submit', async () => {
  let configured = true;
  let refresh: (() => void) | undefined;
  const readRendererUiData = vi.fn(async () => ({ data: {}, configuredSecrets: configured ? ['apiKey'] : [] }));
  const runRendererUiAction = vi.fn(async (input: RuntimePluginUiActionInput) => {
    if (input.secretChanges?.apiKey === null) configured = false;
    else if (input.secretChanges?.apiKey) configured = true;
    refresh?.();
    return { status: 'completed' as const };
  });
  const service = {
    readRendererUiData,
    runRendererUiAction,
    subscribe: () => () => undefined,
    subscribeRendererUiData: (_pluginId: string, listener: () => void) => {
      refresh = listener;
      return () => { refresh = undefined; };
    },
  } as unknown as PluginManagementRendererService;
  const contribution: RuntimePluginUiTreeContribution = {
    id: 'settings', slot: 'renderer.capabilities.plugin.details', tree: { type: 'stack', children: [
      { type: 'field', name: 'city', label: 'City', defaultValue: 'Hangzhou' },
      { type: 'field', name: 'apiKey', label: 'API Key', secret: true },
      { type: 'button', actionId: 'settings.save', label: 'Save' },
    ] },
  };
  render(<DeclarativePluginUiView contribution={contribution} pluginId="search" service={service}
    manifest={{ schemaVersion: 2, actions: [{ id: 'settings.save' }], contributions: [contribution] }}
    translate={(key, params) => key.endsWith('clearSecret') ? `Clear ${params?.name}` : key} />);
  const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  const key = screen.getByLabelText('API Key') as HTMLInputElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  expect(key.value).toBe('');
  await act(async () => fireEvent.click(save));
  expect(runRendererUiAction.mock.calls[0][0]).toMatchObject({ values: { city: 'Hangzhou' } });
  expect(runRendererUiAction.mock.calls[0][0]).not.toHaveProperty('secretChanges');

  runRendererUiAction.mockRejectedValueOnce(new Error('Vault locked'));
  fireEvent.change(key, { target: { value: 'replacement-key' } });
  await act(async () => fireEvent.click(save));
  expect(key.value).toBe('replacement-key');
  await act(async () => fireEvent.click(save));
  expect(runRendererUiAction.mock.calls[2][0]).toMatchObject({
    values: { city: 'Hangzhou' }, secretChanges: { apiKey: 'replacement-key' },
  });
  expect(key.value).toBe('');

  fireEvent.click(screen.getByRole('button', { name: 'Clear API Key' }));
  expect(runRendererUiAction).toHaveBeenCalledTimes(3);
  await act(async () => fireEvent.click(save));
  expect(runRendererUiAction.mock.calls[3][0].secretChanges).toEqual({ apiKey: null });
  await waitFor(() => expect(readRendererUiData).toHaveBeenCalledTimes(4));
});
