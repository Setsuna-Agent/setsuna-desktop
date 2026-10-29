// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@setsuna-desktop/renderer-ui';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModelProviderSettingsState } from '../../src/contracts/index.js';
import { ModelProviderRendererProvider } from '../../src/renderer/context.js';
import { ModelProviderSaveFeedback } from '../../src/renderer/ModelProviderSaveFeedback.js';
import { ModelProviderSettingsView } from '../../src/renderer/ModelProviderSettingsView.js';
import { ModelProviderRendererStateService } from '../../src/renderer/service.js';
import { clientFixture, deferred, stateFromInput, testUi, translate } from './settings-test-support.js';

afterEach(cleanup);

it('retains failed changes after leaving settings and retries them without publishing an unsaved projection', async () => {
  const pending = deferred<ModelProviderSettingsState>();
  const save = vi.fn().mockImplementationOnce(() => pending.promise).mockImplementation(async (input) => stateFromInput(input));
  const service = new ModelProviderRendererStateService(clientFixture(save), null);
  const initial = await service.refresh();
  const tree = (settings: boolean) => <ModelProviderRendererProvider service={service}><ToastProvider>
    <ModelProviderSaveFeedback translate={translate} />
    {settings ? <ModelProviderSettingsView service={service} translate={translate} ui={testUi}
      host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }} /> : null}
  </ToastProvider></ModelProviderRendererProvider>;
  const view = render(tree(true));
  const edited = { ...initial, providers: initial.providers.map((provider) => ({ ...provider, name: 'Unsaved provider' })) };
  act(() => {
    service.stage({ providers: edited.providers.map((provider) => ({ ...provider, apiKey: 'draft-key' })) }, edited);
    service.scheduleSave();
  });
  expect(service.providerProjection()).toEqual(initial);
  view.rerender(tree(false));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  await act(async () => pending.reject(new Error('Disk unavailable')));
  expect((await screen.findByRole('alert')).textContent).toContain('Disk unavailable');
  expect(service.draftApiKeys()).toEqual({ 'provider-1': 'draft-key' });
  expect(service.providerProjection()).toEqual(initial);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(service.providerProjection()?.providers[0].name).toBe('Unsaved provider'));
  expect(service.snapshot().saveError).toBeNull();
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  view.unmount();
  service.dispose();
});
