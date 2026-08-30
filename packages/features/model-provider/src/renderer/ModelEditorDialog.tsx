import type {
  ProviderModelConfig } from '@setsuna-desktop/contracts';
import type { RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { useEffect, useState } from 'react';
import { normalizeThinkingEfforts, ThinkingEffortPicker } from './ThinkingEffortPicker.js';

export function ModelEditorDialog({
  model,
  onCancel,
  onConfirm,
  translate,
  ui,
}: Readonly<{
  model: ProviderModelConfig;
  onCancel(): void;
  onConfirm(model: ProviderModelConfig): void;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const [draft, setDraft] = useState(model);

  useEffect(() => setDraft(model), [model]);

  const Dialog = ui.Dialog;

  return (
    <Dialog
      className="model-provider-settings__model-modal"
      closeLabel={translate('feature.modelProvider.close')}
      footer={(
        <>
          <ui.Button onClick={onCancel}>{translate('feature.modelProvider.cancel')}</ui.Button>
          <ui.Button
            disabled={!draft.code.trim()}
            variant="primary"
            onClick={() => onConfirm(normalizeModel(draft))}
          >
            {translate('feature.modelProvider.saveModel')}
          </ui.Button>
        </>
      )}
      subtitle={draft.name || draft.code || translate('feature.modelProvider.unnamedModel')}
      title={translate('feature.modelProvider.modelSettings')}
      onClose={onCancel}
    >
      <div className="model-provider-settings__model-editor">
        <ModelField label={translate('feature.modelProvider.modelName')}>
          <ui.TextField
            autoFocus
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </ModelField>
        <ModelField label={translate('feature.modelProvider.modelCode')}>
          <ui.TextField
            required
            value={draft.code}
            onChange={(event) => setDraft({ ...draft, code: event.target.value })}
          />
        </ModelField>
        <ModelField label={translate('feature.modelProvider.contextWindow')}>
          <ui.TextField
            min={1}
            type="number"
            value={draft.contextWindowTokens?.toString() ?? ''}
            onChange={(event) => setDraft({ ...draft, contextWindowTokens: positiveInt(event.target.value) })}
          />
        </ModelField>
        <ModelField label={translate('feature.modelProvider.maxOutput')}>
          <ui.TextField
            min={1}
            type="number"
            value={draft.maxOutputTokens}
            onChange={(event) => setDraft({ ...draft, maxOutputTokens: positiveInt(event.target.value) ?? 1 })}
          />
        </ModelField>
        <div className="model-provider-settings__model-flags">
          <ui.Checkbox
            checked={draft.thinkingEnabled}
            onChange={(thinkingEnabled) => setDraft({
              ...draft,
              thinkingEnabled,
              defaultThinkingEffort: thinkingEnabled
                ? draft.defaultThinkingEffort ?? draft.thinkingEfforts[0]
                : undefined,
            })}
          >
            {translate('feature.modelProvider.thinking')}
          </ui.Checkbox>
          <ui.Checkbox
            checked={draft.supportsImages === true}
            onChange={(supportsImages) => setDraft({ ...draft, supportsImages })}
          >
            {translate('feature.modelProvider.images')}
          </ui.Checkbox>
        </div>
        {draft.thinkingEnabled ? (
          <ThinkingEffortPicker
            defaultEffort={draft.defaultThinkingEffort}
            efforts={draft.thinkingEfforts}
            translate={translate}
            ui={ui}
            onChange={(thinkingEfforts, defaultThinkingEffort) => setDraft({
              ...draft,
              thinkingEfforts,
              defaultThinkingEffort,
            })}
          />
        ) : null}
      </div>
    </Dialog>
  );
}

function ModelField({ children, label }: Readonly<{
  children: React.ReactNode;
  label: string;
}>) {
  return <label className="model-provider-settings__field"><span>{label}</span>{children}</label>;
}

function normalizeModel(model: ProviderModelConfig): ProviderModelConfig {
  const code = model.code.trim();
  const name = model.name.trim() || code;
  const thinkingEfforts = normalizeThinkingEfforts(model.thinkingEfforts);
  const defaultThinkingEffort = model.thinkingEnabled
    ? thinkingEfforts.includes(model.defaultThinkingEffort ?? '')
      ? model.defaultThinkingEffort
      : thinkingEfforts[0]
    : undefined;
  return { ...model, code, name, thinkingEfforts, defaultThinkingEffort };
}

function positiveInt(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}
