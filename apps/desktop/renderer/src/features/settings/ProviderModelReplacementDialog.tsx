import type { ProviderModelConfig } from '@setsuna-desktop/contracts';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from '../../shared/ui/primitives.js';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';

type ProviderModelReplacementDialogProps = {
  providerName: string;
  currentModels: ProviderModelConfig[];
  nextModels: ProviderModelConfig[];
  onCancel: () => void;
  onConfirm: () => void;
};

export function ProviderModelReplacementDialog({
  providerName,
  currentModels,
  nextModels,
  onCancel,
  onConfirm,
}: ProviderModelReplacementDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const currentCodes = new Set(currentModels.map(modelComparisonKey));
  const nextCodes = new Set(nextModels.map(modelComparisonKey));
  const addedCount = nextModels.filter((model) => !currentCodes.has(modelComparisonKey(model))).length;
  const removedCount = currentModels.filter((model) => !nextCodes.has(modelComparisonKey(model))).length;
  const retainedCount = nextModels.length - addedCount;
  const columns = [
    { key: 'current', title: t('settings.replacement.current'), models: currentModels, comparisonCodes: nextCodes },
    { key: 'next', title: t('settings.replacement.next'), models: nextModels, comparisonCodes: currentCodes },
  ] as const;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const dialog = (
    <div className="desktop-agent-modal-backdrop settings-model-replacement-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="desktop-agent-modal settings-model-replacement-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-model-replacement-dialog__header">
          <div className="settings-model-replacement-dialog__title">
            <AlertTriangle size={17} aria-hidden="true" />
            <div>
              <strong id={titleId}>{t('settings.replacement.title', { provider: providerName || t('settings.replacement.unnamedProvider') })}</strong>
              <span>{t('settings.replacement.countChange', { current: currentModels.length, next: nextModels.length })}</span>
            </div>
          </div>
          <IconButton label={t('settings.replacement.cancelLabel')} onClick={onCancel}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="settings-model-replacement-dialog__body">
          <p id={descriptionId}>{t('settings.replacement.description')}</p>
          <div className="settings-model-replacement-summary" aria-label={t('settings.replacement.summary')}>
            <span>{t('settings.replacement.added', { count: addedCount })}</span>
            <span>{t('settings.replacement.removed', { count: removedCount })}</span>
            <span>{t('settings.replacement.retained', { count: retainedCount })}</span>
          </div>
          <div className="settings-model-replacement-columns">
            {columns.map((column) => (
              <section className="settings-model-replacement-column" key={column.key} aria-label={column.title}>
                <div className="settings-model-replacement-column__head">
                  <strong>{column.title}</strong>
                  <span>{t('settings.replacement.itemCount', { count: column.models.length })}</span>
                </div>
                <div className="settings-model-replacement-list" role="list">
                  {column.models.map((model) => {
                    const retained = column.comparisonCodes.has(modelComparisonKey(model));
                    const changeLabel = retained ? t('settings.replacement.retain') : column.key === 'current' ? t('settings.replacement.willRemove') : t('settings.replacement.add');
                    return (
                      <div className="settings-model-replacement-item" key={`${model.id}:${model.code}`} role="listitem">
                        <div className="settings-model-replacement-item__body">
                          <strong>{model.name || model.code || t('settings.providers.unnamedModel')}</strong>
                          <code>{model.code || t('settings.providers.missingModelId')}</code>
                          <span>{modelDetails(model, t)}</span>
                        </div>
                        <div className="settings-model-replacement-item__meta">
                          {model.enabled ? <span>{t('settings.replacement.default')}</span> : null}
                          <span className={`is-${retained ? 'retained' : column.key === 'current' ? 'removed' : 'added'}`}>{changeLabel}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
        <footer className="settings-model-replacement-dialog__footer">
          <Button autoFocus type="button" onClick={onCancel}>
            {t('settings.replacement.keepCurrent')}
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            {t('settings.replacement.confirm')}
          </Button>
        </footer>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

function modelComparisonKey(model: ProviderModelConfig): string {
  return model.code.trim() || model.id;
}

function modelDetails(model: ProviderModelConfig, t: Translate): string {
  return [
    t('settings.replacement.output', { tokens: model.maxOutputTokens }),
    model.contextWindowTokens ? t('settings.replacement.context', { tokens: model.contextWindowTokens }) : '',
    model.thinkingEnabled ? t('settings.providers.thinking') : '',
    model.supportsImages ? t('settings.providers.images') : '',
  ].filter(Boolean).join(' · ');
}
