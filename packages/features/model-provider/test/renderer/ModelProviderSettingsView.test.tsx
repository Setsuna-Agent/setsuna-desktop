// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ModelProviderCatalog,
  ModelProviderSettingsInput,
  ModelProviderSettingsState,
} from '../../src/contracts/index.js';
import type { ModelProviderClient } from '../../src/renderer/client.js';
import { ModelProviderSettingsView } from '../../src/renderer/ModelProviderSettingsView.js';
import { modelProviderMessages } from '../../src/renderer/messages.js';
import { ProviderEditor } from '../../src/renderer/ProviderEditor.js';
import { ProviderModelList } from '../../src/renderer/ProviderModelList.js';
import { ModelProviderRendererStateService } from '../../src/renderer/service.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ModelProviderSettingsView', () => {
  it('auto-saves developer role changes and explicitly clears the override when automatic is selected', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (input) => stateFromInput(input));
    const service = new ModelProviderRendererStateService(clientFixture(save), null);
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
      await user.click(await screen.findByRole('button', { name: '高级配置' }));
      for (const [value, override] of [['false', false], ['true', true], ['auto', null]] as const) {
        await user.selectOptions(screen.getByLabelText('Developer role'), value);
        await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
          providers: [expect.objectContaining({ supportsDeveloperRole: override })],
        })));
        expect(service.snapshot().state?.providers[0].supportsDeveloperRole).toBe(override ?? undefined);
      }
    } finally {
      view.unmount();
      service.dispose();
    }
  });

  it('tests the current connection without saving or replacing models and blocks invalid header drafts', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (input) => stateFromInput(input));
    const client = clientFixture(save);
    const state = await client.read();
    const provider = state.providers[0]!;
    provider.apiKeySet = true;
    provider.apiKeyPreview = 'sk-saved';
    provider.proxyRoute = { mode: 'direct' };
    provider.requestHeaders = { 'x-route': 'test-route' };
    provider.models = [modelFixture('retained-model', 'Retained model', true)];
    const pending = deferred<{ models: Array<{ id: string; name: string }> }>();
    const discover = vi.fn<ModelProviderClient['discover']>().mockImplementationOnce(() => pending.promise);
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
    try {
      await user.click(await screen.findByRole('button', { name: '测试连接' }));
      const testingButton = screen.getByRole('button', { name: '测试中…' });
      expect((testingButton as HTMLButtonElement).disabled).toBe(true);
      expect(discover).toHaveBeenCalledWith({
        providerId: provider.id,
        catalogProviderId: provider.catalogProviderId,
        provider: provider.provider,
        baseUrl: provider.baseUrl,
        proxyRoute: provider.proxyRoute,
        requestHeaders: provider.requestHeaders,
        apiKey: undefined,
      }, { signal: expect.any(AbortSignal) });
      await act(async () => pending.resolve({ models: [{ id: 'remote-model', name: 'Remote model' }] }));
      expect(screen.getByRole('status').textContent).toBe('连接成功');
      expect(service.snapshot().state).toEqual(state);
      expect(save).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();

      discover.mockRejectedValueOnce(new Error('401 Unauthorized'));
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      expect((await screen.findByRole('alert')).textContent).toBe('连接失败：401 Unauthorized');

      await user.click(screen.getByRole('button', { name: '高级配置' }));
      fireEvent.change(screen.getByLabelText('请求头名称 1'), { target: { value: 'invalid header' } });
      expect((screen.getByRole('button', { name: '测试连接' }) as HTMLButtonElement).disabled).toBe(true);
      expect(discover).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      service.dispose();
    }
  });

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

  it('persists an edit staged while the previous debounced save is still in flight', async () => {
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

    fireEvent.change(apiKey, { target: { value: 'second-secret' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(saves).toHaveLength(1);
    await act(async () => { gates[0]!.resolve(stateFromInput(saves[0]!)); });
    expect(saves).toHaveLength(2);
    expect(saves[1]?.providers[0]?.apiKey).toBe('second-secret');

    await act(async () => { gates[1]!.resolve(stateFromInput(saves[1]!)); });
    expect(save).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it('keeps the Pi preset flow to provider, key, and catalog model while hiding raw fields from the primary form', async () => {
    const save = vi.fn(async (input) => input as ModelProviderSettingsState);
    const service = new ModelProviderRendererStateService(clientFixture(save), null);
    service.start();
    const { container } = render(
      <ModelProviderSettingsView
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        service={service}
        translate={translate}
        ui={testUi}
      />,
    );

    const vendor = await screen.findByLabelText('厂商');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect((vendor as HTMLSelectElement).value).toBe('deepseek');
    expect(screen.getByLabelText('API Key')).toBeTruthy();
    const primaryForm = container.querySelector('.model-provider-settings__primary-fields');
    expect(primaryForm?.textContent).not.toContain('协议');
    expect(primaryForm?.textContent).not.toContain('API Base URL');

    fireEvent.click(screen.getByRole('button', { name: '添加模型' }));
    fireEvent.click(screen.getByRole('button', { name: '全选结果' }));
    fireEvent.click(screen.getByRole('button', { name: '添加 2 个模型' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(save).toHaveBeenCalled();
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({
      providers: [{
        catalogProviderId: 'deepseek',
        provider: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com',
        models: [{
          code: 'deepseek-model',
          enabled: true,
          contextWindowTokens: 128_000,
          thinkingEnabled: true,
        }, {
          code: 'deepseek-chat',
          enabled: false,
        }],
      }],
    });
    service.dispose();
  });

  it('discards model discovery results after the provider connection changes', async () => {
    const user = userEvent.setup();
    const discovery = deferred<{ models: Array<{ id: string; name: string }> }>();
    const provider: ProviderConfigState = {
      id: 'custom-provider',
      name: 'Custom',
      catalogProviderId: null,
      provider: 'openai-compatible',
      baseUrl: 'https://old.example/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [],
    };
    const service = new ModelProviderRendererStateService({
      copyApiKey: async () => ({ ok: true }),
      catalog: async () => ({ providers: [] }),
      refreshCatalog: async () => ({ catalog: { providers: [] } }),
      read: async () => ({ activeProviderId: provider.id, providers: [provider] }),
      save: async (input) => stateFromInput(input),
      discover: async () => discovery.promise,
    }, null);
    service.start();
    render(
      <ModelProviderSettingsView
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        service={service}
        translate={translate}
        ui={testUi}
      />,
    );

    await user.click(await screen.findByRole('button', { name: '同步模型' }));
    const nextProvider = { ...provider, catalogProviderId: 'preset-sharing-the-same-endpoint' };
    act(() => service.stage({
      activeProviderId: provider.id,
      providers: [providerInputFixture(nextProvider)],
    }, {
      activeProviderId: provider.id,
      providers: [nextProvider],
    }));
    await waitFor(() => expect(service.snapshot().state?.providers[0]?.catalogProviderId)
      .toBe('preset-sharing-the-same-endpoint'));
    await act(async () => discovery.resolve({ models: [{ id: 'stale-model', name: 'Stale model' }] }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    service.dispose();
  });

  it('does not show an obsolete discovery error after the provider connection changes', async () => {
    const user = userEvent.setup();
    const discovery = deferred<{ models: Array<{ id: string; name: string }> }>();
    const provider: ProviderConfigState = {
      id: 'custom-provider',
      name: 'Custom',
      catalogProviderId: null,
      provider: 'openai-compatible',
      baseUrl: 'https://old.example/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [],
    };
    const service = new ModelProviderRendererStateService({
      copyApiKey: async () => ({ ok: true }),
      catalog: async () => ({ providers: [] }),
      refreshCatalog: async () => ({ catalog: { providers: [] } }),
      read: async () => ({ activeProviderId: provider.id, providers: [provider] }),
      save: async (input) => stateFromInput(input),
      discover: async () => discovery.promise,
    }, null);
    service.start();
    render(
      <ModelProviderSettingsView
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        service={service}
        translate={translate}
        ui={testUi}
      />,
    );

    await user.click(await screen.findByRole('button', { name: '同步模型' }));
    const nextProvider = { ...provider, baseUrl: 'https://new.example/v1' };
    act(() => service.stage({
      activeProviderId: provider.id,
      providers: [providerInputFixture(nextProvider)],
    }, {
      activeProviderId: provider.id,
      providers: [nextProvider],
    }));
    await waitFor(() => expect(service.snapshot().state?.providers[0]?.baseUrl).toBe('https://new.example/v1'));
    await act(async () => discovery.reject(new Error('old endpoint rejected the key')));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    service.dispose();
  });

  it('shows model discovery failures through the shared toast surface', async () => {
    const user = userEvent.setup();
    const provider: ProviderConfigState = {
      id: 'custom-provider',
      name: 'Custom',
      catalogProviderId: null,
      provider: 'openai-compatible',
      baseUrl: 'https://custom.example/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [],
    };
    const service = new ModelProviderRendererStateService({
      copyApiKey: async () => ({ ok: true }),
      catalog: async () => ({ providers: [] }),
      refreshCatalog: async () => ({ catalog: { providers: [] } }),
      read: async () => ({ activeProviderId: provider.id, providers: [provider] }),
      save: async (input) => stateFromInput(input),
      discover: async () => {
        throw new Error('provider rejected the request');
      },
    }, null);
    service.start();
    render(
      <ModelProviderSettingsView
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        service={service}
        translate={translate}
        ui={testUi}
      />,
    );

    await user.click(await screen.findByRole('button', { name: '同步模型' }));

    expect((await screen.findByRole('alert')).textContent)
      .toContain('同步模型失败：provider rejected the request');
    service.dispose();
  });

  it('keeps discovery valid while a legacy custom identity is persisted as explicit null', async () => {
    const user = userEvent.setup();
    const discovery = deferred<{ models: Array<{ id: string; name: string }> }>();
    const provider: ProviderConfigState = {
      id: 'legacy-custom-provider',
      name: 'Legacy custom',
      provider: 'openai-compatible',
      baseUrl: 'https://custom.example/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [],
    };
    const service = new ModelProviderRendererStateService({
      copyApiKey: async () => ({ ok: true }),
      catalog: async () => ({ providers: [] }),
      refreshCatalog: async () => ({ catalog: { providers: [] } }),
      read: async () => ({ activeProviderId: provider.id, providers: [provider] }),
      save: async (input) => stateFromInput(input),
      discover: async () => discovery.promise,
    }, null);
    service.start();
    render(
      <ModelProviderSettingsView
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        service={service}
        translate={translate}
        ui={testUi}
      />,
    );

    await user.click(await screen.findByRole('button', { name: '同步模型' }));
    const persistedProvider = { ...provider, catalogProviderId: null };
    act(() => service.stage({
      activeProviderId: provider.id,
      providers: [providerInputFixture(persistedProvider)],
    }, {
      activeProviderId: provider.id,
      providers: [persistedProvider],
    }));
    await act(async () => discovery.resolve({ models: [{ id: 'current-model', name: 'Current model' }] }));

    expect((await screen.findByRole('dialog')).textContent).toContain('替换“Legacy custom”的模型列表？');
    service.dispose();
  });

  it('edits custom model details in a dialog and persists only after confirmation', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const provider: ProviderConfigState = {
      id: 'custom-provider',
      name: 'Custom',
      provider: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [],
    };
    render(
      <ProviderModelList
        discovering={false}
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        provider={provider}
        translate={translate}
        ui={testUi}
        onChange={onChange}
        onDiscover={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '自定义模型' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.type(await screen.findByLabelText('模型 ID'), 'custom-chat');
    await user.click(screen.getByRole('checkbox', { name: '支持思考' }));
    await user.click(screen.getByRole('button', { name: 'high' }));
    await user.click(screen.getByRole('button', { name: 'max' }));
    expect((screen.getByLabelText('默认档位') as HTMLSelectElement).value).toBe('high');
    await user.click(screen.getByRole('button', { name: '保存模型' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      models: [expect.objectContaining({
        code: 'custom-chat',
        name: 'custom-chat',
        enabled: true,
        thinkingEnabled: true,
        thinkingEfforts: ['high', 'max'],
        defaultThinkingEffort: 'high',
      })],
    }));
  });

  it('deletes selected models only after confirming the batch operation', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const provider: ProviderConfigState = {
      id: 'provider-openai',
      name: 'OpenAI',
      provider: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [
        modelFixture('model-alpha', 'Alpha', true),
        modelFixture('model-beta', 'Beta'),
        modelFixture('model-gamma', 'Gamma'),
      ],
    };
    render(
      <ProviderModelList
        discovering={false}
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        provider={provider}
        translate={translate}
        ui={testUi}
        onChange={onChange}
        onDiscover={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '批量管理' }));
    await user.click(screen.getByRole('checkbox', { name: '选择“Alpha”' }));
    await user.click(screen.getByRole('checkbox', { name: '选择“Beta”' }));
    await user.click(screen.getByRole('button', { name: '删除所选' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('删除选中的 2 个模型？');
    expect(onChange).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '删除 2 个' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      models: [expect.objectContaining({ id: 'model-gamma', enabled: true })],
    }));
  });

  it('always confirms a synchronized model list before applying it, even when it is unchanged', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const provider: ProviderConfigState = {
      id: 'custom-provider',
      name: 'Custom',
      provider: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [modelFixture('model-alpha', 'Alpha', true)],
    };
    render(
      <ProviderModelList
        discovering={false}
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        provider={provider}
        translate={translate}
        ui={testUi}
        onChange={onChange}
        onDiscover={vi.fn(async () => provider.models.map((model) => ({ ...model })))}
      />,
    );

    await user.click(screen.getByRole('button', { name: '同步模型' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('替换“Custom”的模型列表？');
    expect(dialog.textContent).toContain('1 个模型 → 1 个模型');
    expect(onChange).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '确认替换' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      models: [expect.objectContaining({ id: 'model-alpha' })],
    }));
  });

  it('keeps provider deletion in a stable host dialog until explicitly confirmed', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const provider: ProviderConfigState = {
      id: 'provider-openai',
      name: 'OpenAI',
      provider: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [],
    };
    render(
      <ProviderEditor
        apiKey=""
        canDelete
        catalog={{ providers: [] }}
        discovering={false}
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        provider={provider}
        proxyServers={[]}
        translate={translate}
        ui={testUi}
        onCopyApiKey={async () => undefined}
        onApiKeyChange={vi.fn()}
        onChange={vi.fn()}
        onDelete={onDelete}
        onDiscover={vi.fn()}
        onTestConnection={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '删除服务' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('删除“OpenAI”？');
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '删除服务' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it.each(['', 'replacement-secret'])('retains configuration and API key draft %j when saving vendor and plan changes', async (apiKeyDraft) => {
    const provider: ProviderConfigState = {
      id: 'provider-deepseek',
      name: 'My service',
      catalogProviderId: 'deepseek',
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      enabled: true,
      apiKeySet: true,
      apiKeyPreview: 'sk-••••',
      requestHeaders: { 'x-custom-key': 'custom-value' },
      proxyRoute: { mode: 'direct' },
      models: [modelFixture('deepseek-chat', 'DeepSeek Chat', true)],
    };
    const catalog: ModelProviderCatalog = {
      providers: [...clientCatalogFixture().providers, {
        id: 'openai',
        name: 'OpenAI',
        plans: [{
          id: 'openai:responses',
          name: 'OpenAI Responses',
          provider: 'openai-responses',
          baseUrl: 'https://api.openai.com/v1',
          models: [],
        }, {
          id: 'openai:chat',
          name: 'OpenAI Chat Completions',
          provider: 'openai-compatible',
          baseUrl: 'https://gateway.example/v1',
          models: [],
        }],
      }],
    };
    const afterVendor: ProviderConfigState = {
      ...provider, catalogProviderId: 'openai', provider: 'openai-responses', baseUrl: 'https://api.openai.com/v1',
    };
    const afterPlan: ProviderConfigState = {
      ...afterVendor, provider: 'openai-compatible', baseUrl: 'https://gateway.example/v1',
    };
    const save = vi.fn<ModelProviderClient['save']>()
      .mockResolvedValueOnce({ activeProviderId: provider.id, providers: [afterVendor] })
      .mockResolvedValueOnce({ activeProviderId: provider.id, providers: [afterPlan] });
    const service = new ModelProviderRendererStateService({
      ...clientFixture(save),
      read: async () => ({ activeProviderId: provider.id, providers: [provider] }),
      catalog: async () => catalog,
      refreshCatalog: async () => ({ catalog }),
    }, null);
    service.start();
    render(
      <ModelProviderSettingsView
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        service={service}
        translate={translate}
        ui={testUi}
      />,
    );

    const vendor = await screen.findByLabelText('厂商');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    if (apiKeyDraft) fireEvent.change(screen.getByLabelText(/^API Key/u), { target: { value: apiKeyDraft } });
    fireEvent.change(vendor, { target: { value: 'openai' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(service.snapshot().state?.providers[0]).toEqual(afterVendor);
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });

    fireEvent.change(screen.getByLabelText('接入方案'), { target: { value: 'openai:chat' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(service.snapshot().state?.providers[0]).toEqual(afterPlan);
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });

    expect(save).toHaveBeenCalledTimes(2);
    for (const [index, expected] of [afterVendor, afterPlan].entries()) {
      expect(save.mock.calls[index]?.[0]).toEqual({
        activeProviderId: provider.id,
        providers: [{
          ...providerInputFixture(expected),
          icon: null,
          requestHeaders: provider.requestHeaders,
          supportsDeveloperRole: provider.supportsDeveloperRole ?? null,
          ...(apiKeyDraft ? { apiKey: apiKeyDraft } : {}),
        }],
      });
    }
    expect(service.snapshot().state?.providers[0]).toEqual(afterPlan);
    expect((screen.getByLabelText(/^API Key/u) as HTMLInputElement).value).toBe(apiKeyDraft);
    service.dispose();
  });

  it.each(['', 'replacement-secret'])('preserves preset configuration when switching to custom with API key draft %j', async (apiKeyDraft) => {
    const provider: ProviderConfigState = {
      id: 'provider-deepseek',
      name: 'My DeepSeek',
      catalogProviderId: 'deepseek',
      provider: 'openai-compatible',
      baseUrl: 'https://gateway.example/deepseek/v1',
      enabled: true,
      apiKeySet: true,
      apiKeyPreview: 'sk-••••',
      proxyRoute: { mode: 'direct' },
      models: [modelFixture('deepseek-chat', 'DeepSeek Chat', true)],
    };
    const customProvider = { ...provider, catalogProviderId: null };
    const save = vi.fn(async (_input: ModelProviderSettingsInput) => ({
      activeProviderId: provider.id,
      providers: [customProvider],
    }));
    const service = new ModelProviderRendererStateService({
      copyApiKey: async () => ({ ok: true }),
      catalog: async () => clientCatalogFixture(),
      refreshCatalog: async () => ({ catalog: clientCatalogFixture() }),
      read: async () => ({ activeProviderId: provider.id, providers: [provider] }),
      save,
      discover: async () => ({ models: [] }),
    }, null);
    service.start();
    render(
      <ModelProviderSettingsView
        host={{ BrandIcon: () => null, BrandIconPicker: () => null, networkProxyBridge: null }}
        service={service}
        translate={translate}
        ui={testUi}
      />,
    );

    const vendor = await screen.findByLabelText('厂商');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const apiKey = screen.getByLabelText(/^API Key/u) as HTMLInputElement;
    if (apiKeyDraft) fireEvent.change(apiKey, { target: { value: apiKeyDraft } });
    fireEvent.change(vendor, { target: { value: '__custom__' } });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(service.snapshot().state?.providers[0]).toEqual(customProvider);
    expect(apiKey.value).toBe(apiKeyDraft);
    expect((screen.getByLabelText('API Base URL') as HTMLInputElement).value).toBe(provider.baseUrl);
    expect(screen.getByText('DeepSeek Chat')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(save).toHaveBeenCalled();
    const saved = save.mock.calls.at(-1)?.[0];
    expect(saved).toEqual({
      activeProviderId: provider.id,
      providers: [{
        ...providerInputFixture(customProvider),
        icon: null,
        requestHeaders: null,
        supportsDeveloperRole: provider.supportsDeveloperRole ?? null,
        ...(apiKeyDraft ? { apiKey: apiKeyDraft } : {}),
      }],
    });
    service.dispose();
  });
});

function modelFixture(id: string, name: string, enabled = false): ProviderConfigState['models'][number] {
  return {
    id,
    name,
    code: name.toLowerCase(),
    enabled,
    maxOutputTokens: 8_192,
    thinkingEnabled: false,
    thinkingEfforts: [],
    supportsImages: false,
  };
}

function clientFixture(save: ModelProviderClient['save']): ModelProviderClient {
  const state: ModelProviderSettingsState = {
    activeProviderId: 'provider-1',
    providers: [{
      id: 'provider-1',
      name: 'DeepSeek',
      catalogProviderId: 'deepseek',
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [],
    }],
  };
  const catalog = clientCatalogFixture();
  return {
    copyApiKey: async () => ({ ok: true }),
    catalog: async () => catalog,
    refreshCatalog: async () => ({ catalog }),
    read: async () => state,
    save,
    discover: async () => ({ models: [] }),
  };
}

function clientCatalogFixture(): ModelProviderCatalog {
  return {
    providers: [{
      id: 'deepseek',
      name: 'DeepSeek',
      plans: [{
        id: 'deepseek:openai-completions',
        name: 'OpenAI Chat Completions',
        provider: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com',
        models: [{
          code: 'deepseek-model',
          name: 'DeepSeek Model',
          contextWindowTokens: 128_000,
          maxOutputTokens: 16_000,
          thinkingEnabled: true,
          thinkingEfforts: ['low', 'high'],
          defaultThinkingEffort: 'high',
          supportsImages: false,
        }, {
          code: 'deepseek-chat',
          name: 'DeepSeek Chat',
          contextWindowTokens: 64_000,
          maxOutputTokens: 8_000,
          thinkingEnabled: false,
          thinkingEfforts: [],
          supportsImages: false,
        }],
      }],
    }],
  };
}

function stateFromInput(input: ModelProviderSettingsInput): ModelProviderSettingsState {
  return {
    activeProviderId: input.activeProviderId,
    providers: input.providers.map((provider) => ({
      id: provider.id!,
      name: provider.name!,
      catalogProviderId: provider.catalogProviderId,
      requestHeaders: provider.requestHeaders ?? undefined,
      supportsDeveloperRole: provider.supportsDeveloperRole ?? undefined,
      provider: provider.provider!,
      baseUrl: provider.baseUrl!,
      enabled: provider.enabled ?? true,
      apiKeySet: Boolean(provider.apiKey),
      apiKeyPreview: provider.apiKey ? 'sk-••••' : '',
      models: provider.models ?? [],
    })),
  };
}

function providerInputFixture(provider: ProviderConfigState): ModelProviderSettingsInput['providers'][number] {
  return {
    id: provider.id,
    name: provider.name,
    catalogProviderId: provider.catalogProviderId,
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    proxyRoute: provider.proxyRoute,
    models: provider.models,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

const translate = ((key: string, params?: Record<string, unknown>) => {
  const template = modelProviderMessages.messages['zh-CN']?.[key] ?? key;
  return params
    ? template.replace(/\{(\w+)\}/gu, (match, name: string) => String(params[name] ?? match))
    : template;
}) as ComponentProps<typeof ModelProviderSettingsView>['translate'];

const testUi = {
  Button: ({ children, icon: _icon, variant: _variant, ...props }: ComponentProps<SettingsViewUi['Button']>) => (
    <button type="button" {...props}>{children}</button>
  ),
  Checkbox: ({ checked, children, indeterminate: _indeterminate, onChange, ...props }: ComponentProps<SettingsViewUi['Checkbox']>) => (
    <label><input {...props} checked={checked} type="checkbox" onChange={(event) => onChange(event.currentTarget.checked)} />{children}</label>
  ),
  Dialog: ({ children, footer, subtitle, title }: ComponentProps<SettingsViewUi['Dialog']>) => (
    <section role="dialog"><header>{title}{subtitle}</header>{children}<footer>{footer}</footer></section>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  IconButton: ({ children, label, variant: _variant, ...props }: ComponentProps<SettingsViewUi['IconButton']>) => (
    <button {...props} aria-label={label} type="button">{children}</button>
  ),
  PageHeading: ({ action, description, title }: ComponentProps<SettingsViewUi['PageHeading']>) => (
    <header><h1>{title}</h1><p>{description}</p>{action}</header>
  ),
  Section: ({ children, featureId: _featureId, ...props }: ComponentProps<SettingsViewUi['Section']>) => (
    <section {...props}>{children}</section>
  ),
  SelectField: ({ children, onValueChange, ...props }: ComponentProps<SettingsViewUi['SelectField']>) => (
    <select {...props} onChange={(event) => onValueChange(event.currentTarget.value)}>{children}</select>
  ),
  Tooltip: ({ children }: ComponentProps<SettingsViewUi['Tooltip']>) => children,
  TextField: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  TextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  Toast: ({ message, tone }: ComponentProps<SettingsViewUi['Toast']>) => (
    <div data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>{message}</div>
  ),
} as unknown as SettingsViewUi;
