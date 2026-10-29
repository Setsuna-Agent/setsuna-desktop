// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModelProviderSettingsInput } from '../../src/contracts/index.js';
import { ModelProviderSettingsView } from '../../src/renderer/ModelProviderSettingsView.js';
import { ModelProviderRendererStateService } from '../../src/renderer/service.js';
import { clientFixture, modelFixture, providerInputFixture, stateFromInput, testUi, translate } from './settings-test-support.js';

const services: ModelProviderRendererStateService[] = [];
afterEach(() => { cleanup(); services.splice(0).forEach((service) => service.dispose()); });

async function setup() {
  const client = clientFixture(async (input) => stateFromInput(input));
  const base = (await client.read()).providers[0]!;
  let stored = { activeProviderId: 'b', providers: [
    { ...base, id: 'a', name: 'Match Alpha', models: [modelFixture('a-model', 'A model', true)] },
    { ...base, id: 'b', name: 'Hidden', models: [modelFixture('b-model', 'B model', true)] },
    { ...base, id: 'c', name: 'Match Gamma', models: [modelFixture('c-model', 'C model', true)] },
    { ...base, id: 'd', name: 'Other', models: [modelFixture('d-model', 'D model', true)] },
  ] };
  const save = vi.fn(async (input: ModelProviderSettingsInput) => {
    stored = { ...stateFromInput(input), activeProviderId: input.activeProviderId! };
    return stored;
  });
  const service = new ModelProviderRendererStateService({ ...client, read: async () => stored, save }, null);
  services.push(service);
  service.start();
  const view = render(<ModelProviderSettingsView service={service} ui={testUi} translate={translate}
    host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }} />);
  const rail = within(await screen.findByRole('navigation', { name: '模型服务' }));
  await waitFor(() => expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('Hidden'));
  return { ...view, service, save, rail, order: () => service.snapshot().state!.providers.map((provider) => provider.id) };
}

function transfer() {
  const values = new Map<string, string>();
  return {
    get types() { return [...values.keys()]; },
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
    setDragImage: vi.fn(), effectAllowed: 'none', dropEffect: 'none',
  };
}

function drag(type: string, target: HTMLElement, dataTransfer: ReturnType<typeof transfer>, clientY = 0) {
  // happy-dom omits drag coordinates; use the native mouse event shape for drop hit testing.
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  fireEvent(target, event);
}

it('commits only on drop and preserves the selected service, active model and unsaved credentials', async () => {
  const view = await setup();
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-unsaved-draft' } });
  const data = transfer();
  const source = view.rail.getByRole('button', { name: /Match Gamma/ });
  fireEvent.dragStart(source, { dataTransfer: data });
  drag('dragover', view.rail.getByRole('button', { name: /Match Alpha/ }), data, -1);
  expect(view.order()).toEqual(['a', 'b', 'c', 'd']);
  // Drop over the moved placeholder, as in the app sidebar, without losing its target.
  drag('dragover', source, data, -1);
  drag('drop', source, data, -1);
  expect(view.order()).toEqual(['c', 'a', 'b', 'd']);
  expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('Hidden');
  act(() => view.service.flushScheduledSave());
  await waitFor(() => expect(view.save).toHaveBeenCalledWith(expect.objectContaining({
    activeProviderId: 'b', providers: [
      expect.objectContaining({ id: 'c' }), expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ id: 'b', apiKey: 'sk-unsaved-draft', models: [expect.objectContaining({ id: 'b-model', enabled: true })] }),
      expect.objectContaining({ id: 'd' }),
    ],
  })));
  await act(() => view.service.refresh());
  expect(view.order()).toEqual(['c', 'a', 'b', 'd']);
});

it('reorders filtered results within the full list without removing hidden services', async () => {
  const view = await setup();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索模型服务' }), { target: { value: 'Match' } });
  const data = transfer();
  fireEvent.dragStart(view.rail.getByRole('button', { name: /Match Alpha/ }), { dataTransfer: data });
  drag('drop', view.rail.getByRole('button', { name: /Match Gamma/ }), data, 1);
  expect(view.order()).toEqual(['b', 'c', 'a', 'd']);
  act(() => view.service.flushScheduledSave());
  await waitFor(() => expect(view.save).toHaveBeenCalledOnce());
  expect(view.save.mock.calls[0]![0].providers.map((provider) => provider.id)).toEqual(['b', 'c', 'a', 'd']);
});

it('does not save cancelled, external, mismatched or no-op drops', async () => {
  const view = await setup();
  const source = view.rail.getByRole('button', { name: /Match Alpha/ });
  const target = view.rail.getByRole('button', { name: /Other/ });
  const data = transfer();
  fireEvent.dragStart(source, { dataTransfer: data });
  drag('dragover', target, data, 1);
  fireEvent.dragEnd(source, { dataTransfer: data });
  drag('drop', target, data, 1);
  const external = transfer();
  external.setData('text/plain', 'a');
  drag('drop', target, external, 1);
  fireEvent.dragStart(source, { dataTransfer: data });
  data.setData(data.types[0]!, 'forged-id');
  drag('drop', target, data, 1);
  fireEvent.dragStart(source, { dataTransfer: data });
  drag('drop', source, data);
  act(() => view.service.flushScheduledSave());
  expect(view.order()).toEqual(['a', 'b', 'c', 'd']);
  expect(view.save).not.toHaveBeenCalled();
});

it('invalidates a drag when providers change and supports keyboard reordering through the same save path', async () => {
  const view = await setup();
  const data = transfer();
  fireEvent.dragStart(view.rail.getByRole('button', { name: /Match Alpha/ }), { dataTransfer: data });
  const state = view.service.snapshot().state!;
  const next = { ...state, providers: [...state.providers].reverse() };
  act(() => view.service.stage({ ...next, providers: next.providers.map(providerInputFixture) }, next));
  drag('drop', view.rail.getByRole('button', { name: /Match Gamma/ }), data, -1);
  expect(view.order()).toEqual(['d', 'c', 'b', 'a']);
  expect(view.save).not.toHaveBeenCalled();
  fireEvent.keyDown(view.rail.getByRole('button', { name: /Hidden/ }), { altKey: true, key: 'ArrowUp' });
  expect(view.order()).toEqual(['d', 'b', 'c', 'a']);
  act(() => view.service.flushScheduledSave());
  await waitFor(() => expect(view.save).toHaveBeenCalledOnce());
});
