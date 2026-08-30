import type {
  ProviderModelConfig } from '@setsuna-desktop/contracts';
import type { RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { TriangleAlert } from 'lucide-react';

export function ModelSyncConfirmationDialog({
  currentModels,
  nextModels,
  onCancel,
  onConfirm,
  providerName,
  translate,
  ui,
}: Readonly<{
  currentModels: readonly ProviderModelConfig[];
  nextModels: readonly ProviderModelConfig[];
  onCancel(): void;
  onConfirm(): void;
  providerName: string;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const currentCodes = new Set(currentModels.map(modelComparisonKey));
  const nextCodes = new Set(nextModels.map(modelComparisonKey));
  const addedCount = nextModels.filter((model) => !currentCodes.has(modelComparisonKey(model))).length;
  const removedCount = currentModels.filter((model) => !nextCodes.has(modelComparisonKey(model))).length;
  const retainedCount = nextModels.length - addedCount;

  return (
    <ui.Dialog
      className="model-provider-settings__sync-dialog"
      closeLabel={translate('feature.modelProvider.cancel')}
      footer={(
        <>
          <ui.Button onClick={onCancel}>
            {translate('feature.modelProvider.syncKeepCurrent')}
          </ui.Button>
          <ui.Button variant="danger" onClick={onConfirm}>
            {translate('feature.modelProvider.syncConfirm')}
          </ui.Button>
        </>
      )}
      size="large"
      subtitle={translate('feature.modelProvider.syncCountChange', {
        current: currentModels.length,
        next: nextModels.length,
      })}
      title={translate('feature.modelProvider.syncTitle', { provider: providerName })}
      titleIcon={<TriangleAlert size={16} />}
      onClose={onCancel}
    >
      <div className="model-provider-settings__sync-body">
        <p>{translate('feature.modelProvider.syncDescription')}</p>
        <div
          aria-label={translate('feature.modelProvider.syncSummary')}
          className="model-provider-settings__sync-summary"
        >
          <span>{translate('feature.modelProvider.syncAdded', { count: addedCount })}</span>
          <span>{translate('feature.modelProvider.syncRemoved', { count: removedCount })}</span>
          <span>{translate('feature.modelProvider.syncRetained', { count: retainedCount })}</span>
        </div>
        <div className="model-provider-settings__sync-columns">
          <ModelColumn
            comparisonCodes={nextCodes}
            kind="current"
            models={currentModels}
            title={translate('feature.modelProvider.syncCurrent')}
            translate={translate}
          />
          <ModelColumn
            comparisonCodes={currentCodes}
            kind="next"
            models={nextModels}
            title={translate('feature.modelProvider.syncNext')}
            translate={translate}
          />
        </div>
      </div>
    </ui.Dialog>
  );
}

function ModelColumn({
  comparisonCodes,
  kind,
  models,
  title,
  translate,
}: Readonly<{
  comparisonCodes: ReadonlySet<string>;
  kind: 'current' | 'next';
  models: readonly ProviderModelConfig[];
  title: string;
  translate: RendererTranslate;
}>) {
  return (
    <section aria-label={title} className="model-provider-settings__sync-column">
      <header>
        <strong>{title}</strong>
        <span>{translate('feature.modelProvider.syncItemCount', { count: models.length })}</span>
      </header>
      <div className="model-provider-settings__sync-list" role="list">
        {models.map((model) => {
          const retained = comparisonCodes.has(modelComparisonKey(model));
          const status = retained ? 'retained' : kind === 'current' ? 'removed' : 'added';
          return (
            <div className="model-provider-settings__sync-item" key={`${model.id}:${model.code}`} role="listitem">
              <span>
                <strong>{model.name || model.code || translate('feature.modelProvider.unnamedModel')}</strong>
                <code>{model.code || '—'}</code>
                <small>{modelDetails(model, translate)}</small>
              </span>
              <em className={`is-${status}`}>
                {translate(status === 'retained'
                  ? 'feature.modelProvider.syncRetain'
                  : status === 'removed'
                    ? 'feature.modelProvider.syncWillRemove'
                    : 'feature.modelProvider.syncWillAdd')}
              </em>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function modelComparisonKey(model: ProviderModelConfig): string {
  return model.code.trim() || model.id;
}

function modelDetails(model: ProviderModelConfig, translate: RendererTranslate): string {
  return [
    translate('feature.modelProvider.syncOutput', { tokens: model.maxOutputTokens }),
    model.contextWindowTokens
      ? translate('feature.modelProvider.syncContext', { tokens: model.contextWindowTokens })
      : '',
    model.thinkingEnabled ? translate('feature.modelProvider.thinking') : '',
    model.supportsImages ? translate('feature.modelProvider.images') : '',
  ].filter(Boolean).join(' · ');
}
