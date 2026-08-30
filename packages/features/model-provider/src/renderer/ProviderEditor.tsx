import type {
  DesktopNetworkProxyServerState,
  ProviderConfigState } from '@setsuna-desktop/contracts';
import type { RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { Pencil, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { ModelProviderCatalog } from '../contracts/index.js';
import { withBrandIcon } from './brand-icon.js';
import type { ModelProviderRendererHost } from './capabilities.js';
import { ProviderConnection } from './ProviderConnection.js';
import { ProviderModelList } from './ProviderModelList.js';
import { catalogPlanForConfig, catalogProviderForConfig } from './provider-catalog.js';
import { protocolLabel } from './ProviderRail.js';

export function ProviderEditor({
  apiKey,
  catalog,
  canDelete,
  discovering,
  host,
  onApiKeyChange,
  onChange,
  onDelete,
  onDiscover,
  onProviderIdentityChange,
  provider,
  proxyServers,
  translate,
  ui,
}: Readonly<{
  apiKey: string;
  catalog: ModelProviderCatalog;
  canDelete: boolean;
  discovering: boolean;
  host: ModelProviderRendererHost;
  onApiKeyChange(value: string): void;
  onChange(provider: ProviderConfigState): void;
  onDelete(): void;
  onDiscover(): Promise<ProviderConfigState['models'] | undefined>;
  onProviderIdentityChange(provider: ProviderConfigState): void;
  provider: ProviderConfigState;
  proxyServers: readonly DesktopNetworkProxyServerState[];
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const BrandIcon = host.BrandIcon;
  const BrandIconPicker = host.BrandIconPicker;
  const Dialog = ui.Dialog;
  const catalogProvider = catalogProviderForConfig(provider, catalog);
  const catalogPlan = catalogProvider
    ? catalogPlanForConfig(provider, catalogProvider)
    : undefined;
  return (
    <div className="model-provider-settings__editor">
      <header className="model-provider-settings__editor-head">
        <div className={`model-provider-settings__editor-title${provider.enabled ? '' : ' is-disabled'}`}>
          <button
            aria-label={translate('feature.modelProvider.configureProviderIcon', { name: provider.name || provider.id })}
            className="model-provider-settings__provider-icon-trigger"
            title={translate('feature.modelProvider.configureProviderIcon', { name: provider.name || provider.id })}
            type="button"
            onClick={() => setIconPickerOpen(true)}
          >
            <BrandIcon provider={provider} size="large" />
            <span aria-hidden="true"><Pencil size={8} /></span>
          </button>
          <span>
            <strong>{provider.name || provider.id}</strong>
            <small>{protocolLabel(provider.provider)} · {translate('feature.modelProvider.modelCount', { count: provider.models.length })}</small>
          </span>
        </div>
        <div className="model-provider-settings__editor-actions">
          <ui.Checkbox
            aria-label={translate('feature.modelProvider.enabled')}
            checked={provider.enabled}
            onChange={(enabled) => onChange({ ...provider, enabled })}
          >
            {translate('feature.modelProvider.enabled')}
          </ui.Checkbox>
          {canDelete ? (
            <ui.IconButton
              label={translate('feature.modelProvider.deleteProvider')}
              variant="danger"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 size={14} />
            </ui.IconButton>
          ) : null}
        </div>
      </header>
      <div className="model-provider-settings__editor-body">
        <ProviderConnection
          apiKey={apiKey}
          catalog={catalog}
          provider={provider}
          proxyServers={proxyServers}
          translate={translate}
          ui={ui}
          onApiKeyChange={onApiKeyChange}
          onChange={onChange}
          onProviderIdentityChange={onProviderIdentityChange}
        />
        <ProviderModelList
          catalogPlan={catalogPlan}
          discovering={discovering}
          host={host}
          provider={provider}
          translate={translate}
          ui={ui}
          onChange={onChange}
          onDiscover={onDiscover}
        />
      </div>
      {iconPickerOpen ? (
        <BrandIconPicker
          icon={provider.icon}
          provider={provider}
          onClose={() => setIconPickerOpen(false)}
          onConfirm={(icon) => {
            onChange(withBrandIcon(provider, icon));
            setIconPickerOpen(false);
          }}
        />
      ) : null}
      {deleteDialogOpen ? (
        <Dialog
          className="model-provider-settings__confirmation-dialog"
          closeLabel={translate('feature.modelProvider.close')}
          footer={(
            <>
              <ui.Button onClick={() => setDeleteDialogOpen(false)}>
                {translate('feature.modelProvider.cancel')}
              </ui.Button>
              <ui.Button
                variant="danger"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  onDelete();
                }}
              >
                {translate('feature.modelProvider.deleteProvider')}
              </ui.Button>
            </>
          )}
          size="small"
          title={translate('feature.modelProvider.deleteTitle', { name: provider.name || provider.id })}
          titleIcon={<TriangleAlert size={16} />}
          onClose={() => setDeleteDialogOpen(false)}
        >
          <p className="model-provider-settings__delete-confirm-copy">
            {translate('feature.modelProvider.deleteDescription', { count: provider.models.length })}
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
