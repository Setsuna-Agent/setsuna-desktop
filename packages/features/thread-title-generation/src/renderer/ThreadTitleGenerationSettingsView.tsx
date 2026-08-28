import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { useEffect, useState } from 'react';
import type {
  ThreadTitleGenerationModelOption,
  ThreadTitleGenerationSettingsState,
} from '../contracts/index.js';
import type { ThreadTitleGenerationClient } from './client.js';

export function ThreadTitleGenerationSettingsView({
  client,
  translate,
  ui,
}: Readonly<{
  client: ThreadTitleGenerationClient;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { Group, Row, Section, SelectField, Toast } = ui;
  const [state, setState] = useState<ThreadTitleGenerationSettingsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void client.readSettings({ signal: abort.signal }).then(setState).catch((loadError: unknown) => {
      if (!abort.signal.aborted) setError(errorMessage(loadError));
    });
    return () => abort.abort();
  }, [client]);

  const selectedValue = state?.selection ? referenceValue(state.selection) : '';
  const selectionAvailable = !selectedValue || Boolean(
    state?.availableModels.some((option) => referenceValue(option) === selectedValue),
  );

  async function save(value: string) {
    if (!state) return;
    setSaving(true);
    setError(null);
    try {
      const selected = state.availableModels.find((option) => referenceValue(option) === value);
      setState(await client.updateSettings({
        expectedRevision: state.revision,
        selection: selected
          ? { providerId: selected.providerId, modelId: selected.modelId }
          : null,
      }));
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section featureId="thread-title-generation">
      <Group title={translate('feature.threadTitleGeneration.settings.group')}>
        <Row
          label={translate('feature.threadTitleGeneration.settings.model')}
          description={translate('feature.threadTitleGeneration.settings.description')}
        >
          <SelectField
            aria-label={translate('feature.threadTitleGeneration.settings.model')}
            disabled={!state || saving}
            value={selectedValue}
            onValueChange={(value) => { void save(value); }}
          >
            <option value="">{translate('feature.threadTitleGeneration.settings.followCurrent')}</option>
            {!selectionAvailable ? (
              <option value={selectedValue} disabled>
                {translate('feature.threadTitleGeneration.settings.unavailable')}
              </option>
            ) : null}
            {state?.availableModels.map((option) => (
              <option key={referenceValue(option)} value={referenceValue(option)}>
                {modelOptionLabel(option)}
              </option>
            ))}
          </SelectField>
        </Row>
        {state && state.availableModels.length === 0 ? (
          <Toast tone="info" message={translate('feature.threadTitleGeneration.settings.empty')} />
        ) : null}
        {error ? <Toast tone="error" message={error} /> : null}
      </Group>
    </Section>
  );
}

function referenceValue(reference: Readonly<{ providerId: string; modelId: string }>): string {
  return JSON.stringify([reference.providerId, reference.modelId]);
}

function modelOptionLabel(option: ThreadTitleGenerationModelOption): string {
  const model = option.modelName && option.modelName !== option.modelCode
    ? `${option.modelName} (${option.modelCode})`
    : option.modelCode;
  return `${option.providerName} · ${model}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
