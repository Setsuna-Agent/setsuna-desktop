import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { ComponentProps } from 'react';
import type { ModelProviderCatalog, ModelProviderSettingsInput, ModelProviderSettingsState } from '../../src/contracts/index.js';
import type { ModelProviderClient } from '../../src/renderer/client.js';
import { modelProviderMessages } from '../../src/renderer/messages.js';

export function modelFixture(id: string, name: string, enabled = false): ProviderConfigState['models'][number] {
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

export function clientFixture(save: ModelProviderClient['save']): ModelProviderClient {
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

export function clientCatalogFixture(): ModelProviderCatalog {
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

export function stateFromInput(input: ModelProviderSettingsInput): ModelProviderSettingsState {
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

export function providerInputFixture(provider: ProviderConfigState): ModelProviderSettingsInput['providers'][number] {
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

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

export const translate = ((key: string, params?: Record<string, unknown>) => {
  const template = modelProviderMessages.messages['zh-CN']?.[key] ?? key;
  return params
    ? template.replace(/\{(\w+)\}/gu, (match, name: string) => String(params[name] ?? match))
    : template;
}) as RendererTranslate;

export const testUi = {
  ActionMenu: ({ items, onSelect }: ComponentProps<SettingsViewUi['ActionMenu']>) => <div>{items.map((item) => <button key={item.id} disabled={item.disabled} onClick={() => onSelect(item.id)}>{item.label}</button>)}</div>,
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
  SelectField: ({ children, onValueChange, renderOptionIcon: _renderOptionIcon, ...props }: ComponentProps<SettingsViewUi['SelectField']>) => (
    <select {...props} onChange={(event) => onValueChange(event.currentTarget.value)}>{children}</select>
  ),
  Tooltip: ({ children }: ComponentProps<SettingsViewUi['Tooltip']>) => children,
  TextField: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  TextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  Toast: ({ message, tone }: ComponentProps<SettingsViewUi['Toast']>) => (
    <div data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>{message}</div>
  ),
} as unknown as SettingsViewUi;
