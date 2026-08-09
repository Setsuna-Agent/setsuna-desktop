import type { ProviderModelConfig } from '@setsuna-desktop/contracts';
import { Brain, Image as ImageIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button, IconButton, TextField } from '../../../shared/ui/primitives.js';
import {
  customThinkingEfforts,
  normalizeThinkingEfforts,
  positiveInt,
  setCustomThinkingEfforts,
  setThinkingEnabled,
  thinkingPresetOptionsForModel,
  toggleThinkingEffort,
  updateModelCode,
} from './provider-model.js';

export function ProviderModelSettingsDialog({
  defaultMaxOutputTokens,
  model,
  onClose,
  onConfirm,
}: {
  defaultMaxOutputTokens: number;
  model: ProviderModelConfig;
  onClose: () => void;
  onConfirm: (model: ProviderModelConfig) => void;
}) {
  const { t } = useI18n();
  const [draftModel, setDraftModel] = useState(model);
  const thinkingEfforts = normalizeThinkingEfforts([
    ...draftModel.thinkingEfforts,
    draftModel.defaultThinkingEffort,
  ]);
  const customThinkingEffortsText = draftModel.thinkingEnabled
    ? customThinkingEfforts(thinkingEfforts).join(', ')
    : '';

  const updateDraft = (updater: (current: ProviderModelConfig) => ProviderModelConfig) => {
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
      <section className="desktop-agent-modal settings-model-modal" role="dialog" aria-modal="true" aria-label={t('settings.providers.editModel')} onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-model-modal__header">
          <div>
            <strong>{draftModel.name || draftModel.code || t('settings.providers.unnamedModel')}</strong>
            <code>{draftModel.code || t('settings.providers.missingModelId')}</code>
          </div>
          <IconButton label={t('common.close')} onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="settings-model-modal__body">
          <div className="settings-model-modal__grid">
            <label className="settings-model-field">
              <span className="settings-model-label">{t('settings.providers.displayName')}</span>
              <TextField
                autoFocus
                className="settings-local-control"
                value={draftModel.name}
                placeholder={t('settings.providers.displayName')}
                onChange={(event) => {
                  const name = event.target.value;
                  updateDraft((item) => ({ ...item, name }));
                }}
              />
            </label>
            <label className="settings-model-field">
              <span className="settings-model-label">Model ID</span>
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
              <span className="settings-model-label">{t('settings.providers.output')}</span>
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
              <span className="settings-model-label">{t('settings.providers.contextWindow')}</span>
              <TextField
                className="settings-local-control settings-model-context-control"
                type="number"
                min={0}
                placeholder={t('settings.providers.notSet')}
                value={draftModel.contextWindowTokens ?? ''}
                onChange={(event) => {
                  const contextWindowTokens = positiveInt(Number(event.target.value), 0) || undefined;
                  updateDraft((item) => ({ ...item, contextWindowTokens }));
                }}
              />
            </label>
          </div>
          <div className="settings-model-modal__section">
            <span className="settings-model-label">{t('settings.providers.capability')}</span>
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
                <span>{t('settings.providers.thinking')}</span>
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
                <span>{t('settings.providers.images')}</span>
              </label>
            </div>
          </div>
          <div className="settings-model-modal__section">
            <span className="settings-model-label">{t('settings.providers.thinkingLevels')}</span>
            <div className="settings-thinking-levels__content">
              <div className="settings-thinking-presets" aria-label={t('settings.providers.commonThinkingLevels')}>
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
                aria-label={t('settings.providers.customThinkingLevel')}
                className="settings-thinking-input"
                disabled={!draftModel.thinkingEnabled}
                placeholder={t('settings.providers.customLevelPlaceholder')}
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
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="primary" onClick={() => onConfirm(draftModel)}>
              {t('settings.providers.confirm')}
            </Button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
