import type {
  DesktopNetworkProxyRoute,
  DesktopNetworkProxyServerState,
  ModelProviderKind,
  ProviderConfigState,
  } from '@setsuna-desktop/contracts';
import type { RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { ChevronRight, LoaderCircle, PlugZap, SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';
import type { ModelProviderCatalog } from '../contracts/index.js';
import { ProviderApiKeyField } from './ProviderApiKeyField.js';
import { ProviderRequestHeadersField } from './ProviderRequestHeadersField.js';
import { useProviderConnectionTest, type ProviderConnectionTester } from './useProviderConnectionTest.js';
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
  onCopyApiKey,
  onChange,
  onTestConnection,
  provider,
  proxyServers,
  translate,
  ui,
}: Readonly<{
  apiKey: string;
  catalog: ModelProviderCatalog;
  onApiKeyChange(value: string): void;
  onCopyApiKey(): Promise<void>;
  onChange(provider: ProviderConfigState): void;
  onTestConnection: ProviderConnectionTester;
  provider: ProviderConfigState;
  proxyServers: readonly DesktopNetworkProxyServerState[];
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const catalogProvider = catalogProviderForConfig(provider, catalog);
  const plan = catalogPlanForConfig(provider, catalogProvider);
  const custom = !catalogProvider;
  const advancedId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [headersValid, setHeadersValid] = useState(true);
  const { testing, result, runTest } = useProviderConnectionTest(provider, apiKey, onTestConnection);
  return (
    <section className="model-provider-settings__card model-provider-settings__connection">
      <header className="model-provider-settings__section-head">
        <span><strong>{translate('feature.modelProvider.connection')}</strong></span>
      </header>
      <div className="model-provider-settings__primary-fields">
        <Field label={translate('feature.modelProvider.name')}>
          <ui.TextField value={provider.name} onChange={(event) => onChange({ ...provider, name: event.target.value })} />
        </Field>
        <Field label={translate('feature.modelProvider.vendor')}>
          <ui.SelectField
            value={catalogProvider?.id ?? CUSTOM_PROVIDER_ID}
            onValueChange={(value) => {
              const next = catalog.providers.find((candidate) => candidate.id === value);
              if (next) onChange(selectCatalogProvider(provider, next));
              else onChange(detachCatalogProvider(provider));
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
                if (next) onChange(selectCatalogPlan(provider, next));
              }}
            >
              {catalogProvider.plans.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </ui.SelectField>
          </Field>
        ) : null}
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
        <ProviderApiKeyField
          apiKey={apiKey}
          apiKeyPreview={provider.apiKeyPreview}
          apiKeySet={provider.apiKeySet}
          className={catalogProvider && catalogProvider.plans.length > 1 ? '' : 'is-wide'}
          translate={translate}
          ui={ui}
          onChange={onApiKeyChange}
          onCopy={onCopyApiKey}
        />
      </div>
      <div className="model-provider-settings__connection-actions">
        <ui.Button
          aria-controls={advancedId}
          aria-expanded={advancedOpen}
          className="model-provider-settings__advanced-trigger"
          icon={<SlidersHorizontal size={13} />}
          variant="ghost"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {translate('feature.modelProvider.advanced')}
          <ChevronRight className={advancedOpen ? 'is-open' : undefined} size={13} />
        </ui.Button>
        <ui.Button
          disabled={testing || !headersValid || !provider.baseUrl.trim()}
          icon={testing ? <LoaderCircle className="is-spinning" size={13} /> : <PlugZap size={13} />}
          onClick={() => void runTest()}
        >
          {translate(testing ? 'feature.modelProvider.testingConnection' : 'feature.modelProvider.testConnection')}
        </ui.Button>
      </div>
      <div className="model-provider-settings__advanced" hidden={!advancedOpen} id={advancedId}>
        <div className="model-provider-settings__advanced-fields">
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
          {provider.provider === 'openai-compatible' ? (
            <Field label={translate('feature.modelProvider.developerRole')}>
              <ui.SelectField
                value={provider.supportsDeveloperRole === undefined ? 'auto' : String(provider.supportsDeveloperRole)}
                onValueChange={(value) => onChange({
                  ...provider,
                  supportsDeveloperRole: value === 'auto' ? undefined : value === 'true',
                })}
              >
                <option value="auto">{translate('feature.modelProvider.developerRoleAuto')}</option>
                <option value="true">{translate('feature.modelProvider.developerRoleEnabled')}</option>
                <option value="false">{translate('feature.modelProvider.developerRoleDisabled')}</option>
              </ui.SelectField>
            </Field>
          ) : null}
          <Field
            className={provider.provider === 'openai-compatible' ? '' : 'is-wide'}
            label={translate('feature.modelProvider.proxy')}
          >
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
          <ProviderRequestHeadersField
            catalogProviderId={provider.catalogProviderId}
            requestHeaders={provider.requestHeaders}
            translate={translate}
            ui={ui}
            onChange={(requestHeaders) => onChange({ ...provider, requestHeaders })}
            onValidityChange={setHeadersValid}
          />
        </div>
      </div>
      {result ? (
        <ui.Toast
          message={result.ok
            ? translate('feature.modelProvider.connectionSucceeded')
            : translate('feature.modelProvider.connectionFailed', { message: result.message })}
          tone={result.ok ? 'success' : 'error'}
        />
      ) : null}
    </section>
  );
}

function Field({ children, className = '', label }: Readonly<{
  children: React.ReactNode;
  className?: string;
  label: string;
}>) {
  return (
    <label className={`model-provider-settings__field ${className}`}>
      <span>{label}</span>
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
