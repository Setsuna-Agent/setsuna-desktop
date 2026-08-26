// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SettingsViewUi } from '@setsuna-desktop/feature-core/renderer';
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
import { ProviderConnection } from '../../src/renderer/ProviderConnection.js';
import { ProviderModelList } from '../../src/renderer/ProviderModelList.js';
import { ModelProviderRendererStateService } from '../../src/renderer/service.js';

afterEach(cleanup);

describe('ModelProviderSettingsView', () => {
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
    fireEvent.change(apiKey, { target: { value: 'first-secret' } });
    await waitFor(() => expect(saves).toHaveLength(1));

    fireEvent.change(apiKey, { target: { value: 'second-secret' } });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 500)));
    gates[0]!.resolve(stateFromInput(saves[0]!));
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]?.providers[0]?.apiKey).toBe('second-secret');

    gates[1]!.resolve(stateFromInput(saves[1]!));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    service.dispose();
  });

  it('keeps the Pi preset flow to provider, key, and catalog model while hiding raw fields from the primary form', async () => {
    const user = userEvent.setup();
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
    expect((vendor as HTMLSelectElement).value).toBe('deepseek');
    expect(screen.getByLabelText('API Key')).toBeTruthy();
    const primaryForm = container.querySelector('.model-provider-settings__primary-fields');
    expect(primaryForm?.textContent).not.toContain('协议');
    expect(primaryForm?.textContent).not.toContain('API Base URL');

    await user.click(screen.getByRole('button', { name: '添加模型' }));
    await user.click(await screen.findByRole('button', { name: '全选结果' }));
    await user.click(screen.getByRole('button', { name: '添加 2 个模型' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
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
      catalog: async () => ({ providers: [] }),
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
      catalog: async () => ({ providers: [] }),
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
      catalog: async () => ({ providers: [] }),
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
      catalog: async () => ({ providers: [] }),
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
        onApiKeyChange={vi.fn()}
        onChange={vi.fn()}
        onDelete={onDelete}
        onDiscover={vi.fn()}
        onProviderIdentityChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '删除服务' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('删除“OpenAI”？');
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '删除服务' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('confirms a provider switch before clearing models and the saved API key', async () => {
    const user = userEvent.setup();
    const onProviderIdentityChange = vi.fn();
    const provider: ProviderConfigState = {
      id: 'provider-deepseek',
      name: 'DeepSeek',
      catalogProviderId: 'deepseek',
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      enabled: true,
      apiKeySet: true,
      apiKeyPreview: 'sk-••••',
      models: [modelFixture('deepseek-chat', 'DeepSeek Chat', true)],
    };
    render(
      <ProviderConnection
        apiKey=""
        catalog={{
          providers: [{
            id: 'deepseek',
            name: 'DeepSeek',
            plans: [{
              id: 'deepseek:chat',
              name: 'OpenAI Chat Completions',
              provider: 'openai-compatible',
              baseUrl: 'https://api.deepseek.com',
              models: [],
            }],
          }, {
            id: 'openai',
            name: 'OpenAI',
            plans: [{
              id: 'openai:responses',
              name: 'OpenAI Responses',
              provider: 'openai-responses',
              baseUrl: 'https://api.openai.com/v1',
              models: [],
            }],
          }],
        }}
        provider={provider}
        proxyServers={[]}
        translate={translate}
        ui={testUi}
        onApiKeyChange={vi.fn()}
        onChange={vi.fn()}
        onProviderIdentityChange={onProviderIdentityChange}
      />,
    );

    await user.selectOptions(screen.getByLabelText('厂商'), 'openai');
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('更换连接配置？');
    expect(onProviderIdentityChange).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '确认更换' }));
    expect(onProviderIdentityChange).toHaveBeenCalledWith(expect.objectContaining({
      catalogProviderId: 'openai',
      apiKeySet: false,
      models: [],
    }));
  });

  it('clears preset credentials and models before switching to a custom service', async () => {
    const user = userEvent.setup();
    const onProviderIdentityChange = vi.fn();
    const provider: ProviderConfigState = {
      id: 'provider-deepseek',
      name: 'DeepSeek',
      catalogProviderId: 'deepseek',
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      enabled: true,
      apiKeySet: true,
      apiKeyPreview: 'sk-••••',
      models: [modelFixture('deepseek-chat', 'DeepSeek Chat', true)],
    };
    render(
      <ProviderConnection
        apiKey=""
        catalog={clientCatalogFixture()}
        provider={provider}
        proxyServers={[]}
        translate={translate}
        ui={testUi}
        onApiKeyChange={vi.fn()}
        onChange={vi.fn()}
        onProviderIdentityChange={onProviderIdentityChange}
      />,
    );

    await user.selectOptions(screen.getByLabelText('厂商'), '__custom__');
    const dialog = screen.getByRole('dialog');
    expect(onProviderIdentityChange).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '确认更换' }));
    expect(onProviderIdentityChange).toHaveBeenCalledWith(expect.objectContaining({
      catalogProviderId: null,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [],
    }));
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
    catalog: async () => catalog,
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
  TextField: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Toast: ({ message, tone }: ComponentProps<SettingsViewUi['Toast']>) => (
    <div data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>{message}</div>
  ),
} as unknown as SettingsViewUi;
