import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ModelProviderCatalogModel } from '../contracts/index.js';

export function CatalogModelPickerDialog({
  models,
  onCancel,
  onConfirm,
  translate,
  ui,
}: Readonly<{
  models: readonly ModelProviderCatalogModel[];
  onCancel(): void;
  onConfirm(models: ModelProviderCatalogModel[]): void;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const [query, setQuery] = useState('');
  const [selectedCodes, setSelectedCodes] = useState<ReadonlySet<string>>(() => new Set());
  const visibleModels = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? models.filter((model) => `${model.name} ${model.code}`.toLocaleLowerCase().includes(normalized))
      : models;
  }, [models, query]);
  const selectedModels = models.filter((model) => selectedCodes.has(model.code));

  const toggle = (code: string, checked: boolean) => {
    setSelectedCodes((current) => {
      const next = new Set(current);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  };
  const selectVisible = () => {
    setSelectedCodes((current) => new Set([...current, ...visibleModels.map((model) => model.code)]));
  };
  const Dialog = ui.Dialog;

  return (
    <Dialog
      className="model-provider-settings__catalog-modal"
      closeLabel={translate('feature.modelProvider.close')}
      title={translate('feature.modelProvider.catalogModelTitle')}
      size="large"
      onClose={onCancel}
      footer={(
        <div className="model-provider-settings__catalog-footer">
          <span>{translate('feature.modelProvider.selectedModelCount', { count: selectedModels.length })}</span>
          <div>
            <ui.Button onClick={onCancel}>{translate('feature.modelProvider.cancel')}</ui.Button>
            <ui.Button
              disabled={!selectedModels.length}
              variant="primary"
              onClick={() => onConfirm(selectedModels)}
            >
              {translate('feature.modelProvider.addSelectedModels', { count: selectedModels.length })}
            </ui.Button>
          </div>
        </div>
      )}
    >
      <div className="model-provider-settings__catalog-picker">
        <div className="model-provider-settings__catalog-toolbar">
          <label>
            <Search aria-hidden="true" size={14} />
            <ui.TextField
              autoFocus
              aria-label={translate('feature.modelProvider.searchModels')}
              placeholder={translate('feature.modelProvider.searchModels')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <ui.Button disabled={!visibleModels.length} onClick={selectVisible}>
            {translate('feature.modelProvider.selectVisibleModels')}
          </ui.Button>
          <ui.Button disabled={!selectedModels.length} onClick={() => setSelectedCodes(new Set())}>
            {translate('feature.modelProvider.clearSelection')}
          </ui.Button>
        </div>
        <div className="model-provider-settings__catalog-list">
          {visibleModels.length ? visibleModels.map((model) => (
            <label key={model.code} className="model-provider-settings__catalog-row">
              <input
                checked={selectedCodes.has(model.code)}
                type="checkbox"
                onChange={(event) => toggle(model.code, event.currentTarget.checked)}
              />
              <span className="model-provider-settings__catalog-copy">
                <strong>{model.name}</strong>
                <code>{model.code}</code>
              </span>
              <span className="model-provider-settings__catalog-meta">
                {model.contextWindowTokens ? <span>{formatTokens(model.contextWindowTokens)}</span> : null}
                {model.thinkingEnabled ? <span>{translate('feature.modelProvider.thinking')}</span> : null}
                {model.supportsImages ? <span>{translate('feature.modelProvider.images')}</span> : null}
              </span>
            </label>
          )) : (
            <div className="model-provider-settings__catalog-empty">
              {translate('feature.modelProvider.noMatchingModels')}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}
