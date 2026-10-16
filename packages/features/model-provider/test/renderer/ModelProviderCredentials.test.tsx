// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelProviderSettingsInput, ModelProviderSettingsState } from '../../src/contracts/index.js';
import type { ModelProviderClient } from '../../src/renderer/client.js';
import { ModelProviderSettingsView } from '../../src/renderer/ModelProviderSettingsView.js';
import { ModelProviderRendererStateService } from '../../src/renderer/service.js';
import { clientFixture, deferred, stateFromInput, testUi, translate } from './settings-test-support.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('model provider API keys', () => {
  it('copies the saved key without revealing it, prioritizes a draft, and reports copy failures', async () => {
    const user = userEvent.setup();
    const client = clientFixture(async (input) => stateFromInput(input));
    const state = await client.read();
    state.providers[0]!.apiKeySet = true;
    state.providers[0]!.apiKeyPreview = 'sk-••••saved';
    const copyApiKey = vi.fn<ModelProviderClient['copyApiKey']>().mockResolvedValue({ ok: true });
    const service = new ModelProviderRendererStateService({ ...client, copyApiKey }, null);
    service.start();
    const view = render(
      <ModelProviderSettingsView
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        service={service}
        translate={translate}
        ui={testUi}
      />,
    );
    try {
      const input = await screen.findByPlaceholderText('留空以保留现有密钥');
      await user.click(screen.getByRole('button', { name: '复制 API Key' }));
      await screen.findByRole('button', { name: '已复制' });
      expect(copyApiKey).toHaveBeenLastCalledWith({ providerId: 'provider-1', apiKey: undefined });
      expect((input as HTMLInputElement).value).toBe('');
      expect(input.getAttribute('type')).toBe('password');

      fireEvent.change(input, { target: { value: 'new-draft-key' } });
      copyApiKey.mockRejectedValueOnce(new Error('Native clipboard unavailable'));
      await user.click(screen.getByRole('button', { name: '复制 API Key' }));
      expect(await screen.findByRole('alert')).toHaveProperty('textContent', '复制 API Key 失败，请重试。');
      expect(copyApiKey).toHaveBeenLastCalledWith({ providerId: 'provider-1', apiKey: 'new-draft-key' });
      expect(screen.queryByRole('button', { name: '已复制' })).toBeNull();

      await user.click(screen.getByRole('button', { name: '复制 API Key' }));
      await screen.findByRole('button', { name: '已复制' });
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      view.unmount();
      service.dispose();
    }
  });

  it.each(['replace', 'clear'])('persists a key %s while the previous debounced save is still in flight', async (action) => {
    const saves: ModelProviderSettingsInput[] = [];
    const gates = [deferred<ModelProviderSettingsState>(), deferred<ModelProviderSettingsState>()];
    const save = vi.fn(async (input: ModelProviderSettingsInput) => {
      const index = saves.push(structuredClone(input)) - 1;
      return gates[index]!.promise;
    });
    const service = new ModelProviderRendererStateService(clientFixture(save), null);
    service.start();
    render(
      <ModelProviderSettingsView
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        service={service}
        translate={translate}
        ui={testUi}
      />,
    );

    const apiKey = await screen.findByLabelText('API Key');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect((screen.getByRole('button', { name: '复制 API Key' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(apiKey, { target: { value: 'first-secret' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(saves).toHaveLength(1);

    if (action === 'clear') fireEvent.click(screen.getByRole('button', { name: '清除 API Key' }));
    fireEvent.change(apiKey, { target: { value: action === 'clear' ? '  ' : 'second-secret' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(saves).toHaveLength(1);
    await act(async () => { gates[0]!.resolve(stateFromInput(saves[0]!)); });
    expect(saves).toHaveLength(2);
    expect(saves[1]?.providers[0]?.apiKey).toBe(action === 'clear' ? undefined : 'second-secret');
    expect(Boolean(saves[1]?.providers[0]?.clearApiKey)).toBe(action === 'clear');
    if (action === 'clear') expect(service.snapshot().state?.providers[0]?.apiKeySet).toBe(false);

    await act(async () => { gates[1]!.resolve(stateFromInput(saves[1]!)); });
    expect(save).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it('clears a saved key and omits it from connection tests and sync before the deletion has saved', async () => {
    const save = vi.fn(async (input) => stateFromInput(input));
    const client = clientFixture(save);
    const state = await client.read();
    state.providers[0]!.apiKeySet = true;
    state.providers[0]!.apiKeyPreview = 'sk-saved';
    const discover = vi.fn<ModelProviderClient['discover']>().mockResolvedValue({ models: [{ id: 'local', name: 'Local' }] });
    const service = new ModelProviderRendererStateService({ ...client, discover }, null);
    service.start();
    const view = render(
      <ModelProviderSettingsView
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        service={service}
        translate={translate}
        ui={testUi}
      />,
    );
    await screen.findByPlaceholderText('留空以保留现有密钥');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: '清除 API Key' }));
    expect(service.snapshot().state?.providers[0]).toMatchObject({ apiKeySet: false, apiKeyPreview: '' });
    expect((screen.getByRole('button', { name: '复制 API Key' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '测试连接' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '同步模型' })); });
    expect(discover).toHaveBeenCalledTimes(2);
    for (const [input] of discover.mock.calls) {
      expect(input).toMatchObject({ providerId: 'provider-1', apiKey: undefined, clearApiKey: true });
    }
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    expect(save).not.toHaveBeenCalled();
    // Leaving before the debounce expires must still persist the explicit deletion.
    await act(async () => { view.unmount(); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      providers: [expect.objectContaining({ clearApiKey: true })],
    }));
    expect(save.mock.calls[0]?.[0].providers[0]).not.toHaveProperty('apiKey');
    expect(service.snapshot().state?.providers[0]?.apiKeySet).toBe(false);
    service.dispose();
  });
});
