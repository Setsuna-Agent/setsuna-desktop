import { Button as UiButton } from '@setsuna-desktop/renderer-ui';
import type {
  ProviderConfigState } from '@setsuna-desktop/contracts';
import type { RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import type { ModelProviderRendererHost } from './capabilities.js';

export function ProviderRail({
  host,
  onAdd,
  onSelect,
  providers,
  selectedProviderId,
  translate,
  ui,
}: Readonly<{
  host: ModelProviderRendererHost;
  onAdd(): void;
  onSelect(providerId: string): void;
  providers: readonly ProviderConfigState[];
  selectedProviderId?: string;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const visibleProviders = providers.filter((provider) => (
    (provider.name || provider.id).toLocaleLowerCase().includes(query)
  ));
  const BrandIcon = host.BrandIcon;
  return (
    <aside className="model-provider-settings__rail">
      <div className="model-provider-settings__rail-head">
        <h1>{translate('feature.modelProvider.title')}</h1>
        <ui.Button
          className="model-provider-settings__add-provider"
          icon={<Plus size={13} />}
          onClick={() => {
            setSearch('');
            onAdd();
          }}
        >
          {translate('feature.modelProvider.add')}
        </ui.Button>
      </div>
      <label className="model-provider-settings__rail-search">
        <Search aria-hidden="true" size={14} />
        <ui.TextField
          aria-label={translate('feature.modelProvider.searchProviders')}
          placeholder={translate('feature.modelProvider.searchProviders')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <nav className="model-provider-settings__rail-list" aria-label={translate('feature.modelProvider.title')}>
        {visibleProviders.map((provider) => (
          <UiButton variant="ghost"
            key={provider.id}
            aria-current={provider.id === selectedProviderId ? 'true' : undefined}
            className={`model-provider-settings__rail-item${provider.id === selectedProviderId ? ' is-active' : ''}${provider.enabled ? '' : ' is-disabled'}`}
            type="button"
            onClick={() => onSelect(provider.id)}
          >
            <BrandIcon provider={provider} />
            <span className="model-provider-settings__rail-copy">
              <strong>{provider.name || provider.id}</strong>
              <small>
                <span>{protocolLabel(provider.provider)}</span>
                <i aria-hidden="true" />
                <span>{translate('feature.modelProvider.modelCount', { count: provider.models.length })}</span>
              </small>
            </span>
          </UiButton>
        ))}
        {query && !visibleProviders.length ? (
          <div className="model-provider-settings__rail-empty">
            {translate('feature.modelProvider.noMatchingProviders')}
          </div>
        ) : null}
      </nav>
    </aside>
  );
}

export function protocolLabel(provider: ProviderConfigState['provider']): string {
  if (provider === 'openai-responses') return 'Responses';
  if (provider === 'anthropic') return 'Anthropic';
  return 'OpenAI';
}
