import {
  type DesktopNetworkProxyServerState,
  type ProviderConfigState,
  type ProviderModelConfig,
  type RuntimeAvailableModelsResponse,
  type RuntimeConfigState,
  type RuntimeFetchModelsInput,
} from '@setsuna-desktop/contracts';
import { Popconfirm } from 'antd';
import { Globe2, Library, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { BrandIconMark } from '../../../shared/branding/BrandIconMark.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import {
  resolveAutomaticModelBrand,
  resolveAutomaticProviderBrand,
  resolveModelBrand,
  resolveProviderBrand,
} from '../../../shared/branding/providerBranding.js';
import { Button, EmptyState, IconButton, SelectField, TextField } from '../../../shared/ui/primitives.js';
import { formatTokens } from '../../workspace/model.js';
import { BrandIconDialog } from '../BrandIconDialog.js';
import { ProviderModelReplacementDialog } from '../ProviderModelReplacementDialog.js';
import { ProviderModelSettingsDialog } from './ProviderModelSettingsDialog.js';
import { ProviderProxyField } from './ProviderProxyField.js';
import {
  normalizeProviderKind,
  providerBaseUrlPlaceholder,
  providerProtocolLabel,
  providerProtocolMeta,
  providerProtocolOptions,
} from './provider-model.js';
import type { SaveState } from './useProviderAutoSave.js';
import { useProviderSettingsController } from './useProviderSettingsController.js';

export { idleSaveState } from './useProviderAutoSave.js';
export type { SaveState } from './useProviderAutoSave.js';

export function LocalModelSettings({
  config,
  proxyServers,
  onFetchModels,
  onSave,
  onSaveStateChange,
}: {
  config: RuntimeConfigState;
  proxyServers: DesktopNetworkProxyServerState[];
  onFetchModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  onSave: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
  onSaveStateChange: (state: SaveState) => void;
}) {
  const { t } = useI18n();

  const controller = useProviderSettingsController({ config, onFetchModels, onSave, onSaveStateChange, t });
  const {
    apiKeysByProviderId,
    editingModelDialog,
    editingModelIcon,
    editingProviderIcon,
    enabledProviderCount,
    pendingModelReplacement,
    providers,
    selectedFetchState,
    selectedProvider,
    selectedProviderIndex,
  } = controller;
  const {
    addModel,
    addProvider,
    cancelModelReplacement,
    closeModelEditor,
    closeModelIconEditor,
    closeProviderIconEditor,
    commitEditingModel,
    confirmModelIcon,
    confirmModelReplacement,
    confirmProviderIcon,
    editModel,
    fetchModels,
    openModelIconEditor,
    openProviderIconEditor,
    removeModel,
    removeProvider,
    resetModelFetchState,
    selectProvider,
    setProviderApiKey,
    updateProvider,
  } = controller.actions;
  const selectedProviderName = selectedProvider?.name || t('settings.providers.serviceIndex', { index: selectedProviderIndex + 1 });

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__local-llm-section chat-user-settings__local-provider-stack">
      <div className="chat-user-settings__local-provider-layout">
        <aside className="chat-user-settings__local-provider-rail">
          <div className="chat-user-settings__local-provider-rail-head">
            <div>
              <span>{t('settings.providers.serviceList')}</span>
              <strong>{t('settings.providers.serviceSummary', { total: providers.length, enabled: enabledProviderCount })}</strong>
            </div>
            <Button className="chat-user-settings__add-provider" icon={<Plus size={13} />} onClick={addProvider}>
              {t('common.add')}
            </Button>
          </div>
          <nav className="chat-user-settings__local-provider-list" aria-label={t('settings.providers.modelServices')}>
            {providers.map((provider, providerIndex) => (
              <ProviderRailItem
                key={provider.id}
                index={providerIndex}
                provider={provider}
                selected={provider.id === selectedProvider?.id}
                onSelect={() => selectProvider(provider.id)}
              />
            ))}
          </nav>
        </aside>
        {selectedProvider ? (
          <div className="chat-user-settings__local-provider-card">
            <div className="chat-user-settings__local-provider-head">
              <div className="chat-user-settings__local-provider-title">
                <button
                  className="chat-user-settings__provider-brand-trigger"
                  type="button"
                  aria-label={t('settings.providers.configureIcon', { name: selectedProviderName })}
                  title={t('settings.providers.configureServiceIcon')}
                  onClick={() => openProviderIconEditor(selectedProvider.id)}
                >
                  <BrandIconMark brand={resolveProviderBrand(selectedProvider)} fallbackName={selectedProvider.name} size="large" />
                  <span className="chat-user-settings__provider-brand-trigger-edit" aria-hidden="true"><Pencil size={8} /></span>
                </button>
                <span className="chat-user-settings__local-provider-title-copy">
                  <strong>{selectedProviderName}</strong>
                  <span>{`${providerProtocolLabel(selectedProvider.provider)} · ${t('settings.providers.modelCount', { count: selectedProvider.models.length })}`}</span>
                </span>
              </div>
              <div className="chat-user-settings__local-provider-actions">
                <label className="sd-check chat-user-settings__provider-toggle">
                  <span className={selectedProvider.enabled ? 'is-enabled' : ''}>
                    <i aria-hidden="true" />
                    {selectedProvider.enabled ? t('settings.providers.serviceEnabled') : t('settings.providers.serviceDisabled')}
                  </span>
                  <input
                    aria-label={selectedProvider.enabled ? t('settings.providers.disableService') : t('settings.providers.enableService')}
                    type="checkbox"
                    checked={selectedProvider.enabled}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      updateProvider(selectedProvider.id, (item) => ({ ...item, enabled }));
                    }}
                  />
                </label>
                {providers.length > 1 ? (
                  <Popconfirm
                    title={t('settings.providers.deleteServiceTitle', { name: selectedProviderName })}
                    description={t('settings.providers.deleteServiceDescription', { count: selectedProvider.models.length })}
                    placement="bottomRight"
                    okText={t('settings.providers.deleteService')}
                    cancelText={t('common.cancel')}
                    okButtonProps={DANGER_CONFIRM_BUTTON_PROPS}
                    onConfirm={() => removeProvider(selectedProvider.id)}
                  >
                    <IconButton className="chat-user-settings__delete-provider" label={t('settings.providers.deleteService')} variant="danger">
                      <Trash2 size={14} />
                    </IconButton>
                  </Popconfirm>
                ) : null}
              </div>
            </div>
            <div className="chat-user-settings__local-provider-body">
              <section className="settings-form-section settings-provider-connection">
                <header className="settings-provider-section__head">
                  <div className="settings-provider-section__heading">
                    <span className="settings-provider-section__icon">
                      <Globe2 size={15} />
                    </span>
                    <span>
                      <strong>{t('settings.providers.connection')}</strong>
                      <small>{t('settings.providers.connectionDescription')}</small>
                    </span>
                  </div>
                  <code>{providerProtocolMeta(selectedProvider.provider)}</code>
                </header>
                <div className="settings-provider-fields">
                  <label className="settings-provider-field">
                    <span className="settings-provider-field__label">{t('settings.providers.protocol')}</span>
                    <SelectField
                      className="settings-local-control"
                      value={selectedProvider.provider}
                      onValueChange={(nextValue) => {
                        const provider = normalizeProviderKind(nextValue);
                        resetModelFetchState(selectedProvider.id);
                        updateProvider(selectedProvider.id, (item) => ({ ...item, provider }));
                      }}
                    >
                      {providerProtocolOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SelectField>
                  </label>
                  <label className="settings-provider-field">
                    <span className="settings-provider-field__label">{t('settings.providers.displayName')}</span>
                    <TextField
                      className="settings-local-control"
                      value={selectedProvider.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        updateProvider(selectedProvider.id, (item) => ({ ...item, name }));
                      }}
                    />
                  </label>
                  <label className="settings-provider-field">
                    <span className="settings-provider-field__label">{t('settings.providers.serviceUrl')}</span>
                    <TextField
                      className="settings-local-control"
                      value={selectedProvider.baseUrl}
                      placeholder={providerBaseUrlPlaceholder(selectedProvider.provider)}
                      onChange={(event) => {
                        const baseUrl = event.target.value;
                        resetModelFetchState(selectedProvider.id);
                        updateProvider(selectedProvider.id, (item) => ({ ...item, baseUrl }));
                      }}
                    />
                  </label>
                  <label className="settings-provider-field">
                    <span className="settings-provider-field__label">{t('settings.providers.apiKey')} {selectedProvider.apiKeySet ? <em>{selectedProvider.apiKeyPreview}</em> : null}</span>
                    <TextField className="settings-local-control" type="password" value={apiKeysByProviderId[selectedProvider.id] ?? ''} onChange={(event) => setProviderApiKey(selectedProvider.id, event.target.value)} placeholder={selectedProvider.apiKeySet ? t('settings.providers.keepApiKey') : t('settings.providers.optionalApiKey')} />
                  </label>
                  <ProviderProxyField
                    proxyServers={proxyServers}
                    route={selectedProvider.proxyRoute}
                    onChange={(proxyRoute) => updateProvider(selectedProvider.id, (item) => ({ ...item, proxyRoute }))}
                  />
                </div>
              </section>
              <section className="settings-form-section settings-model-section">
                <div className="settings-model-list">
                  <div className="settings-model-list__head">
                    <div className="settings-model-list__heading">
                      <span className="settings-provider-section__icon">
                        <Library size={15} />
                      </span>
                      <span>
                        <strong>{t('settings.providers.models')}</strong>
                        <small>{t('settings.providers.modelsDescription', { count: selectedProvider.models.length })}</small>
                      </span>
                    </div>
                    <div className="settings-model-list__actions">
                      <Button icon={<RefreshCw className={selectedFetchState.fetching ? 'is-spinning' : undefined} size={14} />} disabled={selectedFetchState.fetching} onClick={() => fetchModels(selectedProvider)}>
                        {selectedFetchState.fetching ? t('settings.providers.syncing') : t('settings.providers.syncModels')}
                      </Button>
                      <Button icon={<Plus size={14} />} variant="primary" onClick={() => addModel(selectedProvider.id)}>
                        {t('settings.providers.addModel')}
                      </Button>
                    </div>
                  </div>
                  <div className="settings-model-browser">
                    <div className="settings-model-browser__head" aria-hidden="true">
                      <span>{t('settings.providers.model')}</span>
                      <span>{t('settings.providers.capabilities')}</span>
                      <span>{t('settings.providers.actions')}</span>
                    </div>
                    <div className="settings-model-browser__body" role="list" aria-label={t('settings.providers.modelList')}>
                      {selectedProvider.models.map((model) => (
                        <ProviderModelRow
                          key={model.id}
                          canDelete={selectedProvider.models.length > 1}
                          model={model}
                          provider={selectedProvider}
                          onDelete={() => removeModel(selectedProvider.id, model.id)}
                          onEdit={() => editModel(selectedProvider.id, model.id)}
                          onEditIcon={() => openModelIconEditor(selectedProvider.id, model.id)}
                        />
                      ))}
                    </div>
                  </div>
                  {selectedFetchState.error ? <div className="settings-model-fetch-state settings-model-fetch-state--error">{selectedFetchState.error}</div> : null}
                  {!selectedFetchState.error && selectedFetchState.message ? <div className="settings-model-fetch-state">{selectedFetchState.message}</div> : null}
                </div>
              </section>
            </div>
            {editingModelDialog ? <ProviderModelSettingsDialog key={editingModelDialog.key} defaultMaxOutputTokens={editingModelDialog.defaultMaxOutputTokens} model={editingModelDialog.model} onClose={closeModelEditor} onConfirm={commitEditingModel} /> : null}
          </div>
        ) : (
          <div className="chat-user-settings__local-provider-card">
            <EmptyState title={t('settings.providers.empty')} />
          </div>
        )}
      </div>
      {pendingModelReplacement ? (
        <ProviderModelReplacementDialog
          providerName={pendingModelReplacement.providerName}
          currentModels={pendingModelReplacement.currentModels}
          nextModels={pendingModelReplacement.nextModels}
          onCancel={cancelModelReplacement}
          onConfirm={confirmModelReplacement}
        />
      ) : null}
      {editingProviderIcon ? (
        <BrandIconDialog
          key={editingProviderIcon.id}
          automaticBrand={resolveAutomaticProviderBrand(editingProviderIcon)}
          icon={editingProviderIcon.icon}
          name={editingProviderIcon.name}
          subject="provider"
          onClose={closeProviderIconEditor}
          onConfirm={confirmProviderIcon}
        />
      ) : null}
      {editingModelIcon ? (
        <BrandIconDialog
          key={`${editingModelIcon.provider.id}:${editingModelIcon.model.id}`}
          automaticBrand={resolveAutomaticModelBrand(editingModelIcon.model, editingModelIcon.provider)}
          icon={editingModelIcon.model.icon}
          name={editingModelIcon.model.name || editingModelIcon.model.code}
          subject="model"
          onClose={closeModelIconEditor}
          onConfirm={confirmModelIcon}
        />
      ) : null}
    </div>
  );
}

function ProviderRailItem({
  index,
  provider,
  selected,
  onSelect,
}: {
  index: number;
  provider: ProviderConfigState;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const name = provider.name || t('settings.providers.serviceIndex', { index: index + 1 });
  return (
    <button
      className={`chat-user-settings__local-provider-item ${selected ? 'is-active' : ''}`}
      type="button"
      aria-current={selected ? 'true' : undefined}
      title={`${name} · ${providerProtocolLabel(provider.provider)} · ${t('settings.providers.modelCount', { count: provider.models.length })}`}
      onClick={onSelect}
    >
      <BrandIconMark brand={resolveProviderBrand(provider)} fallbackName={provider.name} />
      <span className="chat-user-settings__local-provider-item-body">
        <span className="chat-user-settings__local-provider-item-main">
          <span className="chat-user-settings__local-provider-item-name">{name}</span>
          <span className={`chat-user-settings__local-provider-item-status ${provider.enabled ? 'is-enabled' : ''}`}>
            <i aria-hidden="true" />
            {provider.enabled ? t('settings.providers.enabled') : t('settings.providers.disabled')}
          </span>
        </span>
        <span className="chat-user-settings__local-provider-item-meta">
          <span>{providerProtocolLabel(provider.provider)}</span>
          <i aria-hidden="true" />
          <span>{t('settings.providers.modelCount', { count: provider.models.length })}</span>
        </span>
      </span>
    </button>
  );
}

function ProviderModelRow({
  canDelete,
  model,
  provider,
  onDelete,
  onEdit,
  onEditIcon,
}: {
  canDelete: boolean;
  model: ProviderModelConfig;
  provider: ProviderConfigState;
  onDelete: () => void;
  onEdit: () => void;
  onEditIcon: () => void;
}) {
  const { t } = useI18n();
  const name = model.name || model.code || t('settings.providers.unnamedModel');
  return (
    <div className="settings-model-option" role="listitem">
      <div className="settings-model-option__body">
        <button
          className="settings-model-option__icon"
          type="button"
          aria-label={t('settings.providers.configureIcon', { name })}
          title={t('settings.providers.configureModelIcon')}
          onClick={onEditIcon}
        >
          <BrandIconMark brand={resolveModelBrand(model, provider)} fallbackName={name} />
          <span className="settings-model-option__icon-edit" aria-hidden="true"><Pencil size={7} /></span>
        </button>
        <span className="settings-model-option__copy">
          <span className="settings-model-option__name">{name}</span>
          <code>{model.code || t('settings.providers.missingModelId')}</code>
        </span>
      </div>
      <span className="settings-model-option__meta">
        {model.contextWindowTokens ? <span title={t('settings.providers.contextWindow')}>{t('settings.providers.contextValue', { tokens: formatTokens(model.contextWindowTokens) })}</span> : null}
        <span title={t('settings.providers.maxOutput')}>{t('settings.providers.outputValue', { tokens: formatTokens(model.maxOutputTokens) })}</span>
        {model.thinkingEnabled ? <span>{t('settings.providers.thinking')}</span> : null}
        {model.supportsImages ? <span>{t('settings.providers.vision')}</span> : null}
      </span>
      <div className="settings-model-option__actions">
        <IconButton label={t('settings.providers.editModel')} onClick={onEdit}>
          <Pencil size={14} />
        </IconButton>
        <IconButton label={t('settings.providers.deleteModel')} variant="danger" disabled={!canDelete} onClick={onDelete}>
          <Trash2 size={14} />
        </IconButton>
      </div>
    </div>
  );
}

const DANGER_CONFIRM_BUTTON_PROPS = { danger: true } as const;

export function AutoSaveStatus({ state }: { state: SaveState }) {
  const visible = Boolean(state.message);
  return (
    <span className={`settings-auto-save-status settings-auto-save-status--${state.status} ${visible ? 'is-visible' : ''}`} aria-live="polite" title={visible ? state.message : undefined}>
      {state.message}
    </span>
  );
}
