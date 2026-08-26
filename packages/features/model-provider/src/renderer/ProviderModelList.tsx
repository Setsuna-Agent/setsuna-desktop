import type { ProviderConfigState, ProviderModelConfig } from '@setsuna-desktop/contracts';
import type { RendererTranslate, SettingsViewUi } from '@setsuna-desktop/feature-core/renderer';
import { ListChecks, Pencil, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ModelProviderCatalogModel, ModelProviderCatalogPlan } from '../contracts/index.js';
import { withBrandIcon } from './brand-icon.js';
import type { ModelProviderRendererHost } from './capabilities.js';
import { CatalogModelPickerDialog } from './CatalogModelPickerDialog.js';
import { ModelEditorDialog } from './ModelEditorDialog.js';
import { ModelSyncConfirmationDialog } from './ModelSyncConfirmationDialog.js';
import { configuredModelFromCatalog, createCustomModel } from './provider-catalog.js';

type ModelEditorState = Readonly<{
  kind: 'create' | 'edit';
  model: ProviderModelConfig;
}>;

export function ProviderModelList({
  catalogPlan,
  discovering,
  host,
  onChange,
  onDiscover,
  provider,
  translate,
  ui,
}: Readonly<{
  catalogPlan?: ModelProviderCatalogPlan;
  discovering: boolean;
  host: ModelProviderRendererHost;
  onChange(provider: ProviderConfigState): void;
  onDiscover(): Promise<readonly ProviderModelConfig[] | undefined>;
  provider: ProviderConfigState;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const [editor, setEditor] = useState<ModelEditorState>();
  const [iconEditorModelId, setIconEditorModelId] = useState<string>();
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedModelIds, setSelectedModelIds] = useState<ReadonlySet<string>>(() => new Set());
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [pendingSyncModels, setPendingSyncModels] = useState<readonly ProviderModelConfig[]>();
  const connectionKey = providerConnectionKey(provider);
  useEffect(() => setPendingSyncModels(undefined), [connectionKey]);
  const iconEditorModel = provider.models.find((model) => model.id === iconEditorModelId);
  const allModelsSelected = provider.models.length > 0 && selectedModelIds.size === provider.models.length;
  const availableModels = useMemo(() => catalogPlan?.models.filter((model) => (
    !provider.models.some((configured) => configured.code === model.code)
  )) ?? [], [catalogPlan, provider.models]);
  const addCatalogModels = (models: readonly ModelProviderCatalogModel[]) => {
    const hasSelectedModel = provider.models.some((candidate) => candidate.enabled);
    const nextModels = models.map((model, index) => configuredModelFromCatalog(
      model,
      !hasSelectedModel && index === 0,
    ));
    onChange({ ...provider, models: [...provider.models, ...nextModels] });
    setCatalogPickerOpen(false);
  };
  const addCustomModel = () => {
    const nextModel = {
      ...createCustomModel(provider.provider),
      enabled: !provider.models.some((model) => model.enabled),
    };
    setEditor({ kind: 'create', model: nextModel });
  };
  const updateModel = (modelId: string, next: ProviderModelConfig) => onChange({
    ...provider,
    models: provider.models.map((model) => model.id === modelId ? next : model),
  });
  const deleteModel = (modelId: string) => {
    const deleting = provider.models.find((model) => model.id === modelId);
    const remaining = provider.models.filter((model) => model.id !== modelId);
    // Keep the chat model picker's internal selection valid after deleting its selected model.
    if (deleting?.enabled && remaining.length) remaining[0] = { ...remaining[0]!, enabled: true };
    onChange({ ...provider, models: remaining });
    if (editor?.model.id === modelId) setEditor(undefined);
    if (iconEditorModelId === modelId) setIconEditorModelId(undefined);
  };
  const leaveBatchMode = () => {
    setBatchMode(false);
    setSelectedModelIds(new Set());
  };
  const setModelSelected = (modelId: string, selected: boolean) => {
    setSelectedModelIds((current) => {
      const next = new Set(current);
      if (selected) next.add(modelId);
      else next.delete(modelId);
      return next;
    });
  };
  const deleteSelectedModels = () => {
    const remaining = provider.models.filter((model) => !selectedModelIds.has(model.id));
    if (remaining.length && !remaining.some((model) => model.enabled)) {
      // Preserve the chat model picker's current selection when its model is removed in a batch.
      remaining[0] = { ...remaining[0]!, enabled: true };
    }
    onChange({ ...provider, models: remaining });
    setBatchDeleteDialogOpen(false);
    leaveBatchMode();
  };
  const requestModelSync = async () => {
    const models = await onDiscover();
    if (models) setPendingSyncModels(models);
  };
  const confirmModel = (model: ProviderModelConfig) => {
    if (editor?.kind === 'create') {
      onChange({ ...provider, models: [...provider.models, model] });
    } else {
      updateModel(model.id, model);
    }
    setEditor(undefined);
  };

  return (
    <>
      <section className="model-provider-settings__card model-provider-settings__models-card">
        <header className="model-provider-settings__models-head">
          <span>
            <strong>{translate('feature.modelProvider.models')}</strong>
            {batchMode ? (
              <small>{translate('feature.modelProvider.selectedModelCount', { count: selectedModelIds.size })}</small>
            ) : null}
          </span>
          <div className="model-provider-settings__model-actions">
            {batchMode ? (
              <>
                <ui.Checkbox
                  checked={allModelsSelected}
                  indeterminate={selectedModelIds.size > 0 && !allModelsSelected}
                  onChange={(checked) => setSelectedModelIds(checked
                    ? new Set(provider.models.map((model) => model.id))
                    : new Set())}
                >
                  {translate('feature.modelProvider.selectAllModels')}
                </ui.Checkbox>
                <ui.Button
                  disabled={!selectedModelIds.size}
                  icon={<Trash2 size={14} />}
                  variant="danger"
                  onClick={() => setBatchDeleteDialogOpen(true)}
                >
                  {translate('feature.modelProvider.deleteSelectedModels')}
                </ui.Button>
                <ui.Button onClick={leaveBatchMode}>
                  {translate('feature.modelProvider.finishBatchManage')}
                </ui.Button>
              </>
            ) : catalogPlan ? (
              <>
                {provider.models.length ? (
                  <ui.Button icon={<ListChecks size={14} />} onClick={() => setBatchMode(true)}>
                    {translate('feature.modelProvider.batchManageModels')}
                  </ui.Button>
                ) : null}
                <ui.Button
                  disabled={!availableModels.length}
                  icon={<Plus size={14} />}
                  variant="primary"
                  onClick={() => setCatalogPickerOpen(true)}
                >
                  {availableModels.length
                    ? translate('feature.modelProvider.addModel')
                    : translate('feature.modelProvider.allModelsAdded')}
                </ui.Button>
              </>
            ) : (
              <>
                {provider.models.length ? (
                  <ui.Button icon={<ListChecks size={14} />} onClick={() => setBatchMode(true)}>
                    {translate('feature.modelProvider.batchManageModels')}
                  </ui.Button>
                ) : null}
                <ui.Button
                  disabled={discovering}
                  icon={<RefreshCw className={discovering ? 'is-spinning' : undefined} size={14} />}
                  onClick={() => void requestModelSync()}
                >
                  {translate('feature.modelProvider.syncModels')}
                </ui.Button>
                <ui.Button icon={<Plus size={14} />} variant="primary" onClick={addCustomModel}>
                  {translate('feature.modelProvider.addCustomModel')}
                </ui.Button>
              </>
            )}
          </div>
        </header>
        {provider.models.length ? (
          <div className="model-provider-settings__model-browser">
            <div className="model-provider-settings__model-list" role="list">
              {provider.models.map((model) => (
                <ModelRow
                  key={model.id}
                  host={host}
                  model={model}
                  provider={provider}
                  translate={translate}
                  ui={ui}
                  selected={selectedModelIds.has(model.id)}
                  selecting={batchMode}
                  onDelete={() => deleteModel(model.id)}
                  onEdit={() => setEditor({ kind: 'edit', model })}
                  onEditIcon={() => setIconEditorModelId(model.id)}
                  onSelectedChange={(selected) => setModelSelected(model.id, selected)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="model-provider-settings__models-empty">
            <strong>{translate('feature.modelProvider.noModels')}</strong>
            <span>{catalogPlan
              ? translate('feature.modelProvider.noModelsCatalogHint')
              : translate('feature.modelProvider.noModelsCustomHint')}</span>
          </div>
        )}
      </section>
      {editor ? (
        <ModelEditorDialog
          key={`${editor.kind}:${editor.model.id}`}
          model={editor.model}
          translate={translate}
          ui={ui}
          onCancel={() => setEditor(undefined)}
          onConfirm={confirmModel}
        />
      ) : null}
      {iconEditorModel ? (
        <host.BrandIconPicker
          icon={iconEditorModel.icon}
          model={iconEditorModel}
          provider={provider}
          onClose={() => setIconEditorModelId(undefined)}
          onConfirm={(icon) => {
            updateModel(iconEditorModel.id, withBrandIcon(iconEditorModel, icon));
            setIconEditorModelId(undefined);
          }}
        />
      ) : null}
      {catalogPickerOpen && catalogPlan ? (
        <CatalogModelPickerDialog
          models={availableModels}
          translate={translate}
          ui={ui}
          onCancel={() => setCatalogPickerOpen(false)}
          onConfirm={addCatalogModels}
        />
      ) : null}
      {batchDeleteDialogOpen ? (
        <ui.Dialog
          className="model-provider-settings__confirmation-dialog"
          closeLabel={translate('feature.modelProvider.close')}
          footer={(
            <>
              <ui.Button onClick={() => setBatchDeleteDialogOpen(false)}>
                {translate('feature.modelProvider.cancel')}
              </ui.Button>
              <ui.Button variant="danger" onClick={deleteSelectedModels}>
                {translate('feature.modelProvider.batchDeleteAction', { count: selectedModelIds.size })}
              </ui.Button>
            </>
          )}
          size="small"
          title={translate('feature.modelProvider.batchDeleteTitle', { count: selectedModelIds.size })}
          titleIcon={<TriangleAlert size={16} />}
          onClose={() => setBatchDeleteDialogOpen(false)}
        >
          <p className="model-provider-settings__delete-confirm-copy">
            {translate('feature.modelProvider.batchDeleteDescription')}
          </p>
        </ui.Dialog>
      ) : null}
      {pendingSyncModels ? (
        <ModelSyncConfirmationDialog
          currentModels={provider.models}
          nextModels={pendingSyncModels}
          providerName={provider.name || provider.id}
          translate={translate}
          ui={ui}
          onCancel={() => setPendingSyncModels(undefined)}
          onConfirm={() => {
            onChange({ ...provider, models: [...pendingSyncModels] });
            setPendingSyncModels(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function ModelRow({
  host,
  model,
  onDelete,
  onEdit,
  onEditIcon,
  onSelectedChange,
  provider,
  selected,
  selecting,
  translate,
  ui,
}: Readonly<{
  host: ModelProviderRendererHost;
  model: ProviderModelConfig;
  onDelete(): void;
  onEdit(): void;
  onEditIcon(): void;
  provider: ProviderConfigState;
  selected: boolean;
  selecting: boolean;
  translate: RendererTranslate;
  ui: SettingsViewUi;
  onSelectedChange(selected: boolean): void;
}>) {
  const BrandIcon = host.BrandIcon;
  const displayName = model.name || model.code || translate('feature.modelProvider.unnamedModel');
  return (
    <div className={`model-provider-settings__model-row${selected ? ' is-selected' : ''}`} role="listitem">
      <div className={`model-provider-settings__model-summary${selecting ? ' is-selecting' : ''}`}>
        <div className={`model-provider-settings__model-identity${selecting ? ' is-selecting' : ''}`}>
          {selecting ? (
            <ui.Checkbox
              aria-label={translate('feature.modelProvider.selectModel', { name: displayName })}
              checked={selected}
              onChange={onSelectedChange}
            />
          ) : null}
          <button
            aria-label={translate('feature.modelProvider.configureModelIcon', { name: displayName })}
            className="model-provider-settings__model-icon-trigger"
            title={translate('feature.modelProvider.configureModelIcon', { name: displayName })}
            type="button"
            disabled={selecting}
            onClick={onEditIcon}
          >
            <BrandIcon model={model} provider={provider} />
            <span aria-hidden="true"><Pencil size={7} /></span>
          </button>
          <span>
            <strong>{displayName}</strong>
            <code>{model.code || '—'}</code>
          </span>
        </div>
        <div className="model-provider-settings__model-meta">
          {model.contextWindowTokens ? <span>{formatTokens(model.contextWindowTokens)}</span> : null}
          {model.thinkingEnabled ? <span>{translate('feature.modelProvider.thinking')}</span> : null}
          {model.supportsImages ? <span>{translate('feature.modelProvider.images')}</span> : null}
        </div>
        {selecting ? null : (
          <div className="model-provider-settings__model-row-actions">
            <ui.IconButton label={translate('feature.modelProvider.editModel')} onClick={onEdit}>
              <Pencil size={13} />
            </ui.IconButton>
            <ui.IconButton label={translate('feature.modelProvider.deleteModel')} variant="danger" onClick={onDelete}>
              <Trash2 size={14} />
            </ui.IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}

function providerConnectionKey(provider: ProviderConfigState): string {
  return JSON.stringify([
    provider.catalogProviderId ?? null,
    provider.provider,
    provider.baseUrl,
    provider.proxyRoute ?? null,
  ]);
}
