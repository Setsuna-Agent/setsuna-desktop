import {
  defaultModelMaxOutputTokens,
  type ProviderConfigState,
  type ProviderModelConfig,
  type RuntimeAvailableModelsResponse,
  type RuntimeConfigState,
  type RuntimeFetchModelsInput,
} from '@setsuna-desktop/contracts';
import { Popconfirm } from 'antd';
import { Brain, Globe2, Image as ImageIcon, Library, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrandIconMark } from '../../../shared/branding/BrandIconMark.js';
import {
  resolveAutomaticModelBrand,
  resolveAutomaticProviderBrand,
  resolveModelBrand,
  resolveProviderBrand,
} from '../../../shared/branding/providerBranding.js';
import { Button, EmptyState, IconButton, SelectField, TextField } from '../../../shared/ui/primitives.js';
import { formatTokens } from '../../workspace/model.js';
import { BrandIconDialog } from '../BrandIconDialog.js';
import { providerModelReplacementDecision } from '../providerModelReplacement.js';
import { ProviderModelReplacementDialog } from '../ProviderModelReplacementDialog.js';
import {
  customThinkingEfforts,
  defaultProviderConfig,
  defaultProviderModel,
  ensureProviderActiveModel,
  hasProviderModel,
  mergeFetchedModels,
  modelWithIcon,
  normalizeProviderKind,
  normalizeProviderModel,
  normalizeSettingsProviders,
  normalizeThinkingEfforts,
  positiveInt,
  prepareProviderForSave,
  providerApiKeyPlaceholder,
  providerBaseUrlPlaceholder,
  providerProtocolLabel,
  providerProtocolMeta,
  providerProtocolOptions,
  providerWithIcon,
  selectedProviderIdFromConfig,
  selectedProviderIdFromProviders,
  setCustomThinkingEfforts,
  setThinkingEnabled,
  thinkingPresetOptionsForModel,
  toggleThinkingEffort,
  updateModelCode,
} from './provider-model.js';

export function LocalModelSettings({
  config,
  onFetchModels,
  onSave,
  onSaveStateChange,
}: {
  config: RuntimeConfigState;
  onFetchModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  onSave: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
  onSaveStateChange: (state: SaveState) => void;
}) {
  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__local-llm-section">
      <ProviderSettings config={config} onFetchModels={onFetchModels} onSave={onSave} onSaveStateChange={onSaveStateChange} />
    </div>
  );
}

function ProviderSettings({
  config,
  onFetchModels,
  onSave,
  onSaveStateChange,
}: {
  config: RuntimeConfigState;
  onFetchModels: (input: RuntimeFetchModelsInput) => Promise<RuntimeAvailableModelsResponse>;
  onSave: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
  onSaveStateChange: (state: SaveState) => void;
}) {
  const [providers, setProviders] = useState<ProviderConfigState[]>(() => normalizeSettingsProviders(config.providers));
  const [selectedProviderId, setSelectedProviderId] = useState(() => selectedProviderIdFromConfig(config));
  const [editingModel, setEditingModel] = useState<EditingModelState | null>(null);
  const [editingModelIcon, setEditingModelIcon] = useState<ModelIconTarget | null>(null);
  const [editingProviderIconId, setEditingProviderIconId] = useState<string | null>(null);
  const [pendingModelReplacement, setPendingModelReplacement] = useState<PendingModelReplacement | null>(null);
  const [apiKeysByProviderId, setApiKeysByProviderId] = useState<Record<string, string>>({});
  const [fetchStateByProviderId, setFetchStateByProviderId] = useState<Record<string, ModelFetchState>>({});
  const [saveState, setSaveState] = useState<SaveState>(() => idleSaveState());
  const [dirtyRevision, setDirtyRevision] = useState(0);
  const providersRef = useRef(providers);
  const apiKeysByProviderIdRef = useRef(apiKeysByProviderId);
  const latestDirtyRevisionRef = useRef(dirtyRevision);
  const saveRequestIdRef = useRef(0);
  const lastStartedRevisionRef = useRef(0);
  const pendingSaveTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const onSaveRef = useRef(onSave);
  providersRef.current = providers;
  apiKeysByProviderIdRef.current = apiKeysByProviderId;
  latestDirtyRevisionRef.current = dirtyRevision;
  onSaveRef.current = onSave;

  useEffect(() => {
    const nextProviders = normalizeSettingsProviders(config.providers);
    setProviders(nextProviders);
    setSelectedProviderId((current) => (nextProviders.some((provider) => provider.id === current) ? current : selectedProviderIdFromProviders(config.activeProviderId, nextProviders)));
    setApiKeysByProviderId((current) => {
      const providerIds = new Set(nextProviders.map((provider) => provider.id));
      return Object.fromEntries(Object.entries(current).filter(([providerId]) => providerIds.has(providerId)));
    });
    setEditingModel((current) => {
      if (!current) return null;
      const providerExists = nextProviders.some((provider) => provider.id === current.providerId);
      if (!providerExists) return null;
      if (current.mode === 'create') return current;
      return hasProviderModel(nextProviders, current.providerId, current.modelId) ? current : null;
    });
    setEditingProviderIconId((current) => (current && nextProviders.some((provider) => provider.id === current) ? current : null));
    setEditingModelIcon((current) => (
      current && hasProviderModel(nextProviders, current.providerId, current.modelId) ? current : null
    ));
    setPendingModelReplacement((current) => (current && nextProviders.some((provider) => provider.id === current.providerId) ? current : null));
    setFetchStateByProviderId({});
  }, [config.activeProviderId, config.providers]);

  useEffect(() => {
    onSaveStateChange(saveState);
  }, [onSaveStateChange, saveState]);

  const saveRevision = useCallback((revision: number) => {
    lastStartedRevisionRef.current = Math.max(lastStartedRevisionRef.current, revision);
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    if (mountedRef.current) setSaveState({ status: 'saving', message: '生效中' });
    return onSaveRef.current(providersRef.current.map(prepareProviderForSave), apiKeysByProviderIdRef.current)
      .then(() => {
        if (mountedRef.current && saveRequestIdRef.current === requestId && latestDirtyRevisionRef.current === revision) {
          setSaveState({ status: 'saved', message: '已生效' });
        }
      })
      .catch((error) => {
        if (mountedRef.current && saveRequestIdRef.current === requestId) {
          setSaveState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
  }, []);

  useEffect(() => {
    if (!dirtyRevision) return undefined;
    const revision = dirtyRevision;
    pendingSaveTimerRef.current = window.setTimeout(() => {
      pendingSaveTimerRef.current = null;
      void saveRevision(revision);
    }, SETTINGS_AUTO_SAVE_DELAY_MS);
    return () => {
      if (pendingSaveTimerRef.current !== null) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
    };
  }, [dirtyRevision, saveRevision]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pendingSaveTimerRef.current !== null) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
      const revision = latestDirtyRevisionRef.current;
      if (revision <= lastStartedRevisionRef.current) return;
      // 离开设置页时必须立即保存最新草稿，而不是取消其防抖等待窗口。
      lastStartedRevisionRef.current = revision;
      void onSaveRef.current(providersRef.current.map(prepareProviderForSave), apiKeysByProviderIdRef.current)
        .catch((error) => console.error('[settings] failed to flush provider settings during unmount', error));
    };
  }, []);

  const markDirty = () => {
    setSaveState({ status: 'saving', message: '生效中' });
    setDirtyRevision((current) => current + 1);
  };

  const updateProvider = (providerId: string, updater: (provider: ProviderConfigState) => ProviderConfigState) => {
    markDirty();
    setProviders((current) => current.map((provider) => (provider.id === providerId ? updater(provider) : provider)));
  };

  const setProviderApiKey = (providerId: string, value: string) => {
    markDirty();
    setApiKeysByProviderId((current) => ({ ...current, [providerId]: value }));
  };

  const addProvider = () => {
    const nextProvider = defaultProviderConfig();
    markDirty();
    setProviders((current) => [...current, nextProvider]);
    setSelectedProviderId(nextProvider.id);
  };

  const removeProvider = (providerId: string) => {
    setEditingProviderIconId((current) => (current === providerId ? null : current));
    setEditingModelIcon((current) => (current?.providerId === providerId ? null : current));
    markDirty();
    setProviders((current) => {
      const removedIndex = Math.max(
        0,
        current.findIndex((provider) => provider.id === providerId)
      );
      const next = current.filter((provider) => provider.id !== providerId);
      const normalizedNext = next.length ? next : [defaultProviderConfig()];
      setSelectedProviderId((selected) => (selected === providerId ? normalizedNext[Math.min(removedIndex, normalizedNext.length - 1)]?.id ?? normalizedNext[0]?.id ?? '' : selected));
      return normalizedNext;
    });
    setApiKeysByProviderId((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
  };

  const addModel = (providerId: string) => {
    const provider = providers.find((item) => item.id === providerId);
    setEditingModel({
      mode: 'create',
      providerId,
      model: defaultProviderModel('', !provider?.models.length, provider?.provider),
    });
  };

  const removeModel = (providerId: string, modelId: string) => {
    setEditingModel((current) => (current?.mode === 'edit' && current.providerId === providerId && current.modelId === modelId ? null : current));
    setEditingModelIcon((current) => (current?.providerId === providerId && current.modelId === modelId ? null : current));
    updateProvider(providerId, (provider) =>
      ensureProviderActiveModel({
        ...provider,
        models: provider.models.filter((model) => model.id !== modelId),
      })
    );
  };

  const commitEditingModel = (nextModel: ProviderModelConfig) => {
    const current = editingModel;
    if (!current) return;
    if (current.mode === 'create') {
      updateProvider(current.providerId, (provider) =>
        ensureProviderActiveModel({
          ...provider,
          models: [...provider.models, normalizeProviderModel(nextModel, provider.models.length === 0, provider.provider)],
        })
      );
    } else {
      updateProvider(current.providerId, (provider) =>
        ensureProviderActiveModel({
          ...provider,
          models: provider.models.map((model) => (model.id === current.modelId ? normalizeProviderModel({ ...nextModel, id: current.modelId }, model.enabled, provider.provider) : model)),
        })
      );
    }
    setEditingModel(null);
  };

  const fetchModels = (provider: ProviderConfigState) => {
    setFetchStateByProviderId((current) => ({
      ...current,
      [provider.id]: { error: '', fetching: true, message: '' },
    }));
    void onFetchModels({
      providerId: provider.id,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      apiKey: apiKeysByProviderId[provider.id] || undefined,
    })
      .then((result) => {
        const currentProvider = providersRef.current.find((item) => item.id === provider.id);
        if (!currentProvider) return;
        const nextModels = mergeFetchedModels(currentProvider.models, result.models, currentProvider.provider);
        const decision = providerModelReplacementDecision(currentProvider.models, nextModels);
        if (decision === 'confirm') {
          setPendingModelReplacement({
            providerId: provider.id,
            providerName: currentProvider.name,
            currentModels: currentProvider.models,
            nextModels,
          });
        } else if (decision === 'apply') {
          updateProvider(provider.id, (item) => ({ ...item, models: nextModels }));
        }
        setFetchStateByProviderId((current) => ({
          ...current,
          [provider.id]: {
            error: '',
            fetching: false,
            message: modelFetchSuccessMessage(decision, result.models.length),
          },
        }));
      })
      .catch((error) => {
        setFetchStateByProviderId((current) => ({
          ...current,
          [provider.id]: {
            ...(current[provider.id] ?? emptyModelFetchState()),
            error: error instanceof Error ? error.message : String(error),
            fetching: false,
            message: '',
          },
        }));
      });
  };

  const cancelModelReplacement = () => {
    const pending = pendingModelReplacement;
    if (!pending) return;
    setPendingModelReplacement(null);
    setFetchStateByProviderId((current) => ({
      ...current,
      [pending.providerId]: {
        ...(current[pending.providerId] ?? emptyModelFetchState()),
        message: '已取消替换，当前模型配置未修改。',
      },
    }));
  };

  const confirmModelReplacement = () => {
    const pending = pendingModelReplacement;
    if (!pending) return;
    setPendingModelReplacement(null);
    updateProvider(pending.providerId, (provider) => ({ ...provider, models: pending.nextModels }));
    setFetchStateByProviderId((current) => ({
      ...current,
      [pending.providerId]: {
        ...(current[pending.providerId] ?? emptyModelFetchState()),
        message: `已确认替换为 ${pending.nextModels.length} 个模型。`,
      },
    }));
  };

  const enabledProviderCount = providers.filter((provider) => provider.enabled).length;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];
  const selectedProviderIndex = selectedProvider ? providers.findIndex((provider) => provider.id === selectedProvider.id) : -1;
  const selectedFetchState = selectedProvider ? fetchStateByProviderId[selectedProvider.id] ?? emptyModelFetchState() : emptyModelFetchState();
  const editingProvider = editingModel ? providers.find((provider) => provider.id === editingModel.providerId) : undefined;
  const editingModelConfig = editingModel?.mode === 'create' ? editingModel.model : editingProvider?.models.find((model) => model.id === editingModel?.modelId);
  const editingProviderIcon = editingProviderIconId ? providers.find((provider) => provider.id === editingProviderIconId) : undefined;
  const editingModelIconProvider = editingModelIcon ? providers.find((provider) => provider.id === editingModelIcon.providerId) : undefined;
  const editingModelIconConfig = editingModelIconProvider?.models.find((model) => model.id === editingModelIcon?.modelId);

  return (
    <div className="chat-user-settings__local-provider-stack">
      <div className="chat-user-settings__local-provider-layout">
        <aside className="chat-user-settings__local-provider-rail">
          <div className="chat-user-settings__local-provider-rail-head">
            <div>
              <span>服务列表</span>
              <strong>{`${providers.length} 个服务 · ${enabledProviderCount} 个启用`}</strong>
            </div>
            <Button className="chat-user-settings__add-provider" icon={<Plus size={13} />} onClick={addProvider}>
              添加
            </Button>
          </div>
          <nav className="chat-user-settings__local-provider-list" aria-label="模型服务">
            {providers.map((provider, providerIndex) => (
              <ProviderRailItem
                key={provider.id}
                index={providerIndex}
                provider={provider}
                selected={provider.id === selectedProvider?.id}
                onSelect={() => setSelectedProviderId(provider.id)}
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
                  aria-label={`配置“${selectedProvider.name || `服务 ${selectedProviderIndex + 1}`}”的图标`}
                  title="配置服务图标"
                  onClick={() => setEditingProviderIconId(selectedProvider.id)}
                >
                  <BrandIconMark brand={resolveProviderBrand(selectedProvider)} fallbackName={selectedProvider.name} size="large" />
                  <span className="chat-user-settings__provider-brand-trigger-edit" aria-hidden="true"><Pencil size={8} /></span>
                </button>
                <span className="chat-user-settings__local-provider-title-copy">
                  <strong>{selectedProvider.name || `服务 ${selectedProviderIndex + 1}`}</strong>
                  <span>{`${providerProtocolLabel(selectedProvider.provider)} · ${selectedProvider.models.length} 个模型`}</span>
                </span>
              </div>
              <div className="chat-user-settings__local-provider-actions">
                <label className="sd-check chat-user-settings__provider-toggle">
                  <span className={selectedProvider.enabled ? 'is-enabled' : ''}>
                    <i aria-hidden="true" />
                    {selectedProvider.enabled ? '服务已启用' : '服务已停用'}
                  </span>
                  <input
                    aria-label={selectedProvider.enabled ? '停用服务' : '启用服务'}
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
                    title={`删除服务“${selectedProvider.name || `服务 ${selectedProviderIndex + 1}`}”？`}
                    description={`将同时删除该服务的 ${selectedProvider.models.length} 个模型和已保存的 API Key，此操作无法撤销。`}
                    placement="bottomRight"
                    okText="删除服务"
                    cancelText="取消"
                    okButtonProps={DANGER_CONFIRM_BUTTON_PROPS}
                    onConfirm={() => removeProvider(selectedProvider.id)}
                  >
                    <IconButton className="chat-user-settings__delete-provider" label="删除服务" variant="danger">
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
                      <strong>连接配置</strong>
                      <small>设置协议、接口地址与访问凭据</small>
                    </span>
                  </div>
                  <code>{providerProtocolMeta(selectedProvider.provider)}</code>
                </header>
                <div className="settings-provider-fields">
                  <label className="settings-provider-field">
                    <span className="settings-provider-field__label">协议</span>
                    <SelectField
                      className="settings-local-control"
                      value={selectedProvider.provider}
                      onValueChange={(nextValue) => {
                        const provider = normalizeProviderKind(nextValue);
                        setFetchStateByProviderId((current) => ({ ...current, [selectedProvider.id]: emptyModelFetchState() }));
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
                    <span className="settings-provider-field__label">显示名称</span>
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
                    <span className="settings-provider-field__label">服务地址</span>
                    <TextField
                      className="settings-local-control"
                      value={selectedProvider.baseUrl}
                      placeholder={providerBaseUrlPlaceholder(selectedProvider.provider)}
                      onChange={(event) => {
                        const baseUrl = event.target.value;
                        setFetchStateByProviderId((current) => ({ ...current, [selectedProvider.id]: emptyModelFetchState() }));
                        updateProvider(selectedProvider.id, (item) => ({ ...item, baseUrl }));
                      }}
                    />
                  </label>
                  <label className="settings-provider-field">
                    <span className="settings-provider-field__label">API 密钥 {selectedProvider.apiKeySet ? <em>{selectedProvider.apiKeyPreview}</em> : null}</span>
                    <TextField className="settings-local-control" type="password" value={apiKeysByProviderId[selectedProvider.id] ?? ''} onChange={(event) => setProviderApiKey(selectedProvider.id, event.target.value)} placeholder={providerApiKeyPlaceholder(selectedProvider)} />
                  </label>
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
                        <strong>模型目录</strong>
                        <small>{`${selectedProvider.models.length} 个模型 · 可自动同步或手动添加`}</small>
                      </span>
                    </div>
                    <div className="settings-model-list__actions">
                      <Button icon={<RefreshCw className={selectedFetchState.fetching ? 'is-spinning' : undefined} size={14} />} disabled={selectedFetchState.fetching} onClick={() => fetchModels(selectedProvider)}>
                        {selectedFetchState.fetching ? '同步中' : '同步模型'}
                      </Button>
                      <Button icon={<Plus size={14} />} variant="primary" onClick={() => addModel(selectedProvider.id)}>
                        添加模型
                      </Button>
                    </div>
                  </div>
                  <div className="settings-model-browser">
                    <div className="settings-model-browser__head" aria-hidden="true">
                      <span>模型</span>
                      <span>能力与限制</span>
                      <span>操作</span>
                    </div>
                    <div className="settings-model-browser__body" role="list" aria-label="模型列表">
                      {selectedProvider.models.map((model) => (
                        <ProviderModelRow
                          key={model.id}
                          canDelete={selectedProvider.models.length > 1}
                          model={model}
                          provider={selectedProvider}
                          onDelete={() => removeModel(selectedProvider.id, model.id)}
                          onEdit={() => setEditingModel({ mode: 'edit', providerId: selectedProvider.id, modelId: model.id })}
                          onEditIcon={() => setEditingModelIcon({ providerId: selectedProvider.id, modelId: model.id })}
                        />
                      ))}
                    </div>
                  </div>
                  {selectedFetchState.error ? <div className="settings-model-fetch-state settings-model-fetch-state--error">{selectedFetchState.error}</div> : null}
                  {!selectedFetchState.error && selectedFetchState.message ? <div className="settings-model-fetch-state">{selectedFetchState.message}</div> : null}
                </div>
              </section>
            </div>
            {editingModel && editingProvider && editingModelConfig ? <ModelSettingsDialog key={`${editingModel.mode}-${editingProvider.id}-${editingModelConfig.id}`} defaultMaxOutputTokens={defaultModelMaxOutputTokens(editingProvider.provider)} model={editingModelConfig} onClose={() => setEditingModel(null)} onConfirm={commitEditingModel} /> : null}
          </div>
        ) : (
          <div className="chat-user-settings__local-provider-card">
            <EmptyState title="暂无模型服务" />
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
          onClose={() => setEditingProviderIconId(null)}
          onConfirm={(icon) => {
            updateProvider(editingProviderIcon.id, (provider) => providerWithIcon(provider, icon));
            setEditingProviderIconId(null);
          }}
        />
      ) : null}
      {editingModelIconProvider && editingModelIconConfig ? (
        <BrandIconDialog
          key={`${editingModelIconProvider.id}:${editingModelIconConfig.id}`}
          automaticBrand={resolveAutomaticModelBrand(editingModelIconConfig, editingModelIconProvider)}
          icon={editingModelIconConfig.icon}
          name={editingModelIconConfig.name || editingModelIconConfig.code}
          subject="model"
          onClose={() => setEditingModelIcon(null)}
          onConfirm={(icon) => {
            updateProvider(editingModelIconProvider.id, (provider) => ({
              ...provider,
              models: provider.models.map((model) => (
                model.id === editingModelIconConfig.id ? modelWithIcon(model, icon) : model
              )),
            }));
            setEditingModelIcon(null);
          }}
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
  const name = provider.name || `服务 ${index + 1}`;
  return (
    <button
      className={`chat-user-settings__local-provider-item ${selected ? 'is-active' : ''}`}
      type="button"
      aria-current={selected ? 'true' : undefined}
      title={`${name} · ${providerProtocolLabel(provider.provider)} · ${provider.models.length} 个模型`}
      onClick={onSelect}
    >
      <BrandIconMark brand={resolveProviderBrand(provider)} fallbackName={provider.name} />
      <span className="chat-user-settings__local-provider-item-body">
        <span className="chat-user-settings__local-provider-item-main">
          <span className="chat-user-settings__local-provider-item-name">{name}</span>
          <span className={`chat-user-settings__local-provider-item-status ${provider.enabled ? 'is-enabled' : ''}`}>
            <i aria-hidden="true" />
            {provider.enabled ? '启用' : '停用'}
          </span>
        </span>
        <span className="chat-user-settings__local-provider-item-meta">
          <span>{providerProtocolLabel(provider.provider)}</span>
          <i aria-hidden="true" />
          <span>{`${provider.models.length} 个模型`}</span>
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
  const name = model.name || model.code || '未命名模型';
  return (
    <div className="settings-model-option" role="listitem">
      <div className="settings-model-option__body">
        <button
          className="settings-model-option__icon"
          type="button"
          aria-label={`配置“${name}”的图标`}
          title="配置模型图标"
          onClick={onEditIcon}
        >
          <BrandIconMark brand={resolveModelBrand(model, provider)} fallbackName={name} />
          <span className="settings-model-option__icon-edit" aria-hidden="true"><Pencil size={7} /></span>
        </button>
        <span className="settings-model-option__copy">
          <span className="settings-model-option__name">{name}</span>
          <code>{model.code || '未填写模型 ID'}</code>
        </span>
      </div>
      <span className="settings-model-option__meta">
        {model.contextWindowTokens ? <span title="上下文窗口">{`${formatTokens(model.contextWindowTokens)} 上下文`}</span> : null}
        <span title="最大输出 Token">{`${formatTokens(model.maxOutputTokens)} 输出`}</span>
        {model.thinkingEnabled ? <span>思考</span> : null}
        {model.supportsImages ? <span>视觉</span> : null}
      </span>
      <div className="settings-model-option__actions">
        <IconButton label="编辑模型" onClick={onEdit}>
          <Pencil size={14} />
        </IconButton>
        <IconButton label="删除模型" variant="danger" disabled={!canDelete} onClick={onDelete}>
          <Trash2 size={14} />
        </IconButton>
      </div>
    </div>
  );
}

const SETTINGS_AUTO_SAVE_DELAY_MS = 300;
const DANGER_CONFIRM_BUTTON_PROPS = { danger: true } as const;
type ModelFetchState = {
  error: string;
  fetching: boolean;
  message: string;
};

export type SaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message: string;
};

type EditingModelState = {
  providerId: string;
} & ({ mode: 'edit'; modelId: string } | { mode: 'create'; model: ProviderModelConfig });

type PendingModelReplacement = {
  providerId: string;
  providerName: string;
  currentModels: ProviderModelConfig[];
  nextModels: ProviderModelConfig[];
};

type ModelIconTarget = {
  providerId: string;
  modelId: string;
};

function emptyModelFetchState(): ModelFetchState {
  return { error: '', fetching: false, message: '' };
}

function modelFetchSuccessMessage(decision: ReturnType<typeof providerModelReplacementDecision>, modelCount: number): string {
  if (decision === 'confirm') return `已获取 ${modelCount} 个模型，确认后才会替换当前配置。`;
  if (decision === 'unchanged') return `已获取 ${modelCount} 个模型，与当前配置一致。`;
  return `已获取并应用 ${modelCount} 个模型。`;
}

export function idleSaveState(): SaveState {
  return { status: 'idle', message: '' };
}

export function AutoSaveStatus({ state }: { state: SaveState }) {
  const visible = Boolean(state.message);
  return (
    <span className={`settings-auto-save-status settings-auto-save-status--${state.status} ${visible ? 'is-visible' : ''}`} aria-live="polite" title={visible ? state.message : undefined}>
      {state.message}
    </span>
  );
}

function ModelSettingsDialog({ defaultMaxOutputTokens, model, onClose, onConfirm }: { defaultMaxOutputTokens: number; model: ProviderModelConfig; onClose: () => void; onConfirm: (model: ProviderModelConfig) => void }) {
  const [draftModel, setDraftModel] = useState(model);
  const thinkingEfforts = normalizeThinkingEfforts([...draftModel.thinkingEfforts, draftModel.defaultThinkingEffort]);
  const customThinkingEffortsText = draftModel.thinkingEnabled ? customThinkingEfforts(thinkingEfforts).join(', ') : '';

  const updateDraft = (updater: (model: ProviderModelConfig) => ProviderModelConfig) => {
    setDraftModel((current) => updater(current));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="desktop-agent-modal-backdrop settings-model-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="desktop-agent-modal settings-model-modal" role="dialog" aria-modal="true" aria-label="编辑模型" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-model-modal__header">
          <div>
            <strong>{draftModel.name || draftModel.code || '未命名模型'}</strong>
            <code>{draftModel.code || '未填写模型 ID'}</code>
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="settings-model-modal__body">
          <div className="settings-model-modal__grid">
            <label className="settings-model-field">
              <span className="settings-model-label">显示名称</span>
              <TextField
                autoFocus
                className="settings-local-control"
                value={draftModel.name}
                placeholder="显示名称"
                onChange={(event) => {
                  const name = event.target.value;
                  updateDraft((item) => ({ ...item, name }));
                }}
              />
            </label>
            <label className="settings-model-field">
              <span className="settings-model-label">模型 ID</span>
              <TextField
                className="settings-local-control settings-model-code-control"
                value={draftModel.code}
                placeholder="llama3.1"
                onChange={(event) => {
                  const code = event.target.value;
                  updateDraft((item) => updateModelCode(item, code));
                }}
              />
            </label>
            <label className="settings-model-field">
              <span className="settings-model-label">输出</span>
              <TextField
                className="settings-local-control settings-model-output-control"
                type="number"
                min={1}
                value={draftModel.maxOutputTokens}
                onChange={(event) => {
                  const maxOutputTokens = positiveInt(Number(event.target.value), defaultMaxOutputTokens);
                  updateDraft((item) => ({ ...item, maxOutputTokens }));
                }}
              />
            </label>
            <label className="settings-model-field">
              <span className="settings-model-label">上下文窗口</span>
              <TextField
                className="settings-local-control settings-model-context-control"
                type="number"
                min={0}
                placeholder="未设置"
                value={draftModel.contextWindowTokens ?? ''}
                onChange={(event) => {
                  const contextWindowTokens = positiveInt(Number(event.target.value), 0) || undefined;
                  updateDraft((item) => ({ ...item, contextWindowTokens }));
                }}
              />
            </label>
          </div>
          <div className="settings-model-modal__section">
            <span className="settings-model-label">能力</span>
            <div className="settings-model-inline-checks">
              <label className={`sd-check settings-model-check ${draftModel.thinkingEnabled ? 'is-active' : ''}`}>
                <input
                  type="checkbox"
                  checked={draftModel.thinkingEnabled}
                  onChange={(event) => {
                    const thinkingEnabled = event.currentTarget.checked;
                    updateDraft((item) => setThinkingEnabled(item, thinkingEnabled));
                  }}
                />
                <Brain size={13} />
                <span>思考</span>
              </label>
              <label className={`sd-check settings-model-check ${draftModel.supportsImages ? 'is-active' : ''}`}>
                <input
                  type="checkbox"
                  checked={Boolean(draftModel.supportsImages)}
                  onChange={(event) => {
                    const supportsImages = event.currentTarget.checked;
                    updateDraft((item) => ({ ...item, supportsImages }));
                  }}
                />
                <ImageIcon size={13} />
                <span>图片</span>
              </label>
            </div>
          </div>
          <div className="settings-model-modal__section">
            <span className="settings-model-label">思考等级</span>
            <div className="settings-thinking-levels__content">
              <div className="settings-thinking-presets" aria-label="常用思考等级">
                {thinkingPresetOptionsForModel().map((effort) => {
                  const selected = thinkingEfforts.includes(effort);
                  return (
                    <button key={effort} className={`settings-thinking-preset ${selected ? 'is-active' : ''}`} type="button" aria-pressed={selected} disabled={!draftModel.thinkingEnabled} onClick={() => updateDraft((item) => toggleThinkingEffort(item, effort))}>
                      {effort}
                    </button>
                  );
                })}
              </div>
              <TextField
                aria-label="自定义思考等级"
                className="settings-thinking-input"
                disabled={!draftModel.thinkingEnabled}
                placeholder="自定义档位"
                value={customThinkingEffortsText}
                onChange={(event) => {
                  const efforts = event.target.value;
                  updateDraft((item) => setCustomThinkingEfforts(item, efforts));
                }}
              />
            </div>
          </div>
        </div>
        <footer className="settings-model-modal__footer">
          <div className="settings-model-modal__footer-actions">
            <Button type="button" onClick={onClose}>
              取消
            </Button>
            <Button type="button" variant="primary" onClick={() => onConfirm(draftModel)}>
              确定
            </Button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}
