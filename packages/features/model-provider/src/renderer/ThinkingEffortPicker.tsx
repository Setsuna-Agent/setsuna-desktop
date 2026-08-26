import type { RendererTranslate, SettingsViewUi } from '@setsuna-desktop/feature-core/renderer';
import { Plus } from 'lucide-react';
import { useState } from 'react';

const THINKING_EFFORT_PRESETS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export function ThinkingEffortPicker({
  defaultEffort,
  efforts,
  onChange,
  translate,
  ui,
}: Readonly<{
  defaultEffort?: string;
  efforts: readonly string[];
  onChange(efforts: string[], defaultEffort: string | undefined): void;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const [customDraft, setCustomDraft] = useState('');
  const selected = normalizeThinkingEfforts(efforts);
  const options = normalizeThinkingEfforts([
    ...THINKING_EFFORT_PRESETS,
    ...selected.filter((effort) => !THINKING_EFFORT_PRESETS.includes(effort as typeof THINKING_EFFORT_PRESETS[number])),
  ]);

  const commit = (nextEfforts: string[]) => {
    const normalized = normalizeThinkingEfforts(nextEfforts);
    const nextDefault = defaultEffort && normalized.includes(defaultEffort)
      ? defaultEffort
      : normalized[0];
    onChange(normalized, nextDefault);
  };
  const addCustomEffort = () => {
    const additions = normalizeThinkingEfforts(customDraft);
    if (!additions.length) return;
    commit([...selected, ...additions]);
    setCustomDraft('');
  };

  return (
    <section className="model-provider-settings__thinking-picker">
      <header className="model-provider-settings__thinking-head">
        <span>
          <strong>{translate('feature.modelProvider.thinkingEfforts')}</strong>
          <small>{translate('feature.modelProvider.thinkingEffortsHint')}</small>
        </span>
        <label className="model-provider-settings__thinking-default">
          <span>{translate('feature.modelProvider.defaultThinkingEffort')}</span>
          <ui.SelectField
            aria-label={translate('feature.modelProvider.defaultThinkingEffort')}
            disabled={!selected.length}
            value={defaultEffort && selected.includes(defaultEffort) ? defaultEffort : selected[0] ?? ''}
            onValueChange={(value) => onChange(selected, value || undefined)}
          >
            {!selected.length ? <option value="">—</option> : null}
            {selected.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
          </ui.SelectField>
        </label>
      </header>
      <div className="model-provider-settings__thinking-options" role="group" aria-label={translate('feature.modelProvider.thinkingEfforts')}>
        {options.map((effort) => {
          const active = selected.includes(effort);
          return (
            <button
              key={effort}
              aria-pressed={active}
              className={active ? 'is-active' : ''}
              type="button"
              onClick={() => commit(active
                ? selected.filter((candidate) => candidate !== effort)
                : [...selected, effort])}
            >
              {effort}
            </button>
          );
        })}
      </div>
      <div className="model-provider-settings__thinking-custom">
        <ui.TextField
          aria-label={translate('feature.modelProvider.customThinkingEffort')}
          placeholder={translate('feature.modelProvider.customThinkingEffortPlaceholder')}
          value={customDraft}
          onChange={(event) => setCustomDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            addCustomEffort();
          }}
        />
        <ui.Button disabled={!customDraft.trim()} icon={<Plus size={13} />} onClick={addCustomEffort}>
          {translate('feature.modelProvider.addThinkingEffort')}
        </ui.Button>
      </div>
    </section>
  );
}

export function normalizeThinkingEfforts(value: readonly string[] | string): string[] {
  const raw = typeof value === 'string' ? value.split(/[,，\s]+/u) : value;
  return [...new Set(raw.map((effort) => effort.trim()).filter(Boolean))];
}
