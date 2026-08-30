import type {
  ProviderConfigState } from '@setsuna-desktop/contracts';
import type { RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { Plus } from 'lucide-react';
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
  const enabledCount = providers.filter((provider) => provider.enabled).length;
  const BrandIcon = host.BrandIcon;
  return (
    <aside className="model-provider-settings__rail">
      <div className="model-provider-settings__rail-head">
        <div>
          <span>{translate('feature.modelProvider.provider')}</span>
          <strong>{translate('feature.modelProvider.serviceSummary', { total: providers.length, enabled: enabledCount })}</strong>
        </div>
        <ui.Button className="model-provider-settings__add-provider" icon={<Plus size={13} />} onClick={onAdd}>
          {translate('feature.modelProvider.add')}
        </ui.Button>
      </div>
      <nav className="model-provider-settings__rail-list" aria-label={translate('feature.modelProvider.title')}>
        {providers.map((provider) => (
          <button
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
          </button>
        ))}
      </nav>
    </aside>
  );
}

export function protocolLabel(provider: ProviderConfigState['provider']): string {
  if (provider === 'openai-responses') return 'Responses';
  if (provider === 'anthropic') return 'Anthropic';
  return 'OpenAI';
}
