import type {
  DesktopNetworkProxyRoute,
  DesktopNetworkProxyServerState,
  ModelProviderKind,
  ProviderConfigState,
} from '@setsuna-desktop/contracts';
import type { RendererTranslate, SettingsViewUi } from '@setsuna-desktop/feature-core/renderer';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { ModelProviderCatalog } from '../contracts/index.js';
import {
  CUSTOM_PROVIDER_ID,
  catalogPlanForConfig,
  catalogProviderForConfig,
  detachCatalogProvider,
  selectCatalogPlan,
  selectCatalogProvider,
} from './provider-catalog.js';

export function ProviderConnection({
  apiKey,
  catalog,
  onApiKeyChange,
  onChange,
  onProviderIdentityChange,
  provider,
  proxyServers,
  translate,
  ui,
}: Readonly<{
  apiKey: string;
  catalog: ModelProviderCatalog;
  onApiKeyChange(value: string): void;
  onChange(provider: ProviderConfigState): void;
  onProviderIdentityChange(provider: ProviderConfigState): void;
  provider: ProviderConfigState;
  proxyServers: readonly DesktopNetworkProxyServerState[];
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const catalogProvider = catalogProviderForConfig(provider, catalog);
  const plan = catalogPlanForConfig(provider, catalogProvider);
  const custom = !catalogProvider;
  const [pendingChange, setPendingChange] = useState<Readonly<{
    clearApiKey: boolean;
    provider: ProviderConfigState;
  }> | null>(null);
  const requestChange = (next: ProviderConfigState, clearApiKey: boolean) => {
    const destructive = Boolean(provider.models.length || (clearApiKey && (provider.apiKeySet || apiKey)));
    if (destructive) {
      setPendingChange({ clearApiKey, provider: next });
      return;
    }
    if (clearApiKey) onProviderIdentityChange(next);
    else onChange(next);
  };
  return (
    <section className="model-provider-settings__card model-provider-settings__connection">
      <header className="model-provider-settings__section-head">
        <span><strong>{translate('feature.modelProvider.connection')}</strong></span>
      </header>
      <div className="model-provider-settings__primary-fields">
        <Field label={translate('feature.modelProvider.vendor')}>
          <ui.SelectField
            value={catalogProvider?.id ?? CUSTOM_PROVIDER_ID}
            onValueChange={(value) => {
              const next = catalog.providers.find((candidate) => candidate.id === value);
              if (next) requestChange(selectCatalogProvider(provider, next), true);
              else requestChange(detachCatalogProvider(provider), true);
            }}
          >
            {catalog.providers.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
            <option value={CUSTOM_PROVIDER_ID}>{translate('feature.modelProvider.customProvider')}</option>
          </ui.SelectField>
        </Field>
        {catalogProvider && catalogProvider.plans.length > 1 ? (
          <Field label={translate('feature.modelProvider.plan')}>
            <ui.SelectField
              value={plan?.id ?? ''}
              onValueChange={(value) => {
                const next = catalogProvider.plans.find((candidate) => candidate.id === value);
                if (next) requestChange(selectCatalogPlan(provider, next), false);
              }}
            >
              {catalogProvider.plans.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </ui.SelectField>
          </Field>
        ) : null}
        <Field
          className={catalogProvider && catalogProvider.plans.length > 1 ? 'is-wide' : ''}
          label={translate('feature.modelProvider.apiKey')}
          meta={provider.apiKeySet ? provider.apiKeyPreview : undefined}
        >
          <ui.TextField
            autoComplete="off"
            placeholder={provider.apiKeySet
              ? translate('feature.modelProvider.keepApiKey')
              : translate('feature.modelProvider.enterApiKey')}
            type="password"
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
        </Field>
        {custom ? (
          <>
            <Field label={translate('feature.modelProvider.protocol')}>
              <ProtocolField provider={provider.provider} ui={ui} onChange={(next) => onChange({ ...provider, provider: next })} />
            </Field>
            <Field label={translate('feature.modelProvider.baseUrl')}>
              <ui.TextField value={provider.baseUrl} onChange={(event) => onChange({ ...provider, baseUrl: event.target.value })} />
            </Field>
          </>
        ) : null}
      </div>
      <details className="model-provider-settings__advanced">
        <summary>{translate('feature.modelProvider.advanced')}</summary>
        <div className="model-provider-settings__advanced-fields">
          <Field label={translate('feature.modelProvider.name')}>
            <ui.TextField value={provider.name} onChange={(event) => onChange({ ...provider, name: event.target.value })} />
          </Field>
          {!custom ? (
            <>
              <Field label={translate('feature.modelProvider.protocol')}>
                <ui.TextField disabled value={plan?.name ?? ''} />
              </Field>
              <Field label={translate('feature.modelProvider.baseUrl')}>
                <ui.TextField value={provider.baseUrl} onChange={(event) => onChange({ ...provider, baseUrl: event.target.value })} />
              </Field>
            </>
          ) : null}
          <Field label={translate('feature.modelProvider.proxy')}>
            <ui.SelectField
              value={routeValue(provider.proxyRoute)}
              onValueChange={(value) => onChange({ ...provider, proxyRoute: routeFromValue(value) })}
            >
              <option value="inherit">{translate('feature.modelProvider.proxyInherit')}</option>
              <option value="system">System</option>
              <option value="direct">{translate('feature.modelProvider.proxyDirect')}</option>
              {proxyServers.map((server) => <option key={server.id} value={`proxy:${server.id}`}>{server.name}</option>)}
            </ui.SelectField>
          </Field>
        </div>
      </details>
      {pendingChange ? (
        <ui.Dialog
          className="model-provider-settings__confirmation-dialog"
          closeLabel={translate('feature.modelProvider.close')}
          footer={(
            <>
              <ui.Button onClick={() => setPendingChange(null)}>
                {translate('feature.modelProvider.cancel')}
              </ui.Button>
              <ui.Button
                variant="danger"
                onClick={() => {
                  const next = pendingChange;
                  setPendingChange(null);
                  if (next.clearApiKey) onProviderIdentityChange(next.provider);
                  else onChange(next.provider);
                }}
              >
                {translate('feature.modelProvider.connectionChangeConfirm')}
              </ui.Button>
            </>
          )}
          size="small"
          title={translate('feature.modelProvider.connectionChangeTitle')}
          titleIcon={<TriangleAlert size={16} />}
          onClose={() => setPendingChange(null)}
        >
          <p className="model-provider-settings__delete-confirm-copy">
            {translate(
              pendingChange.clearApiKey
                ? 'feature.modelProvider.providerChangeDescription'
                : 'feature.modelProvider.planChangeDescription',
              { count: provider.models.length },
            )}
          </p>
        </ui.Dialog>
      ) : null}
    </section>
  );
}

function Field({ children, className = '', label, meta }: Readonly<{
  children: React.ReactNode;
  className?: string;
  label: string;
  meta?: string;
}>) {
  return (
    <label className={`model-provider-settings__field ${className}`}>
      <span>{label}{meta ? <em>{meta}</em> : null}</span>
      {children}
    </label>
  );
}

function ProtocolField({ onChange, provider, ui }: Readonly<{
  onChange(provider: ModelProviderKind): void;
  provider: ModelProviderKind;
  ui: SettingsViewUi;
}>) {
  return (
    <ui.SelectField value={provider} onValueChange={(value) => onChange(providerKind(value))}>
      <option value="openai-compatible">OpenAI Chat Completions</option>
      <option value="openai-responses">OpenAI Responses</option>
      <option value="anthropic">Anthropic Messages</option>
    </ui.SelectField>
  );
}

function providerKind(value: string): ModelProviderKind {
  return value === 'openai-responses' || value === 'anthropic' ? value : 'openai-compatible';
}

function routeValue(route: DesktopNetworkProxyRoute | undefined): string {
  if (!route || route.mode === 'inherit') return 'inherit';
  return route.mode === 'proxy' ? `proxy:${route.proxyServerId}` : route.mode;
}

function routeFromValue(value: string): DesktopNetworkProxyRoute {
  if (value === 'system' || value === 'direct') return { mode: value };
  return value.startsWith('proxy:') && value.slice(6)
    ? { mode: 'proxy', proxyServerId: value.slice(6) }
    : { mode: 'inherit' };
}
