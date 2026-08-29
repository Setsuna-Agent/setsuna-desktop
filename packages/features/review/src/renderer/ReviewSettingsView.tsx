import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { useEffect, useState } from 'react';
import type {
  ReviewModelOption,
  ReviewSettingsState,
} from '../contracts/index.js';
import type { ReviewClient } from './client.js';

export function ReviewSettingsView({
  client,
  translate,
  ui,
}: Readonly<{
  client: Pick<ReviewClient, 'readSettings' | 'updateSettings'>;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { Group, Row, Section, SelectField, Toast } = ui;
  const [state, setState] = useState<ReviewSettingsState | null>(null);
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
    <Section featureId="desktop-review">
      <Group title={translate('feature.review.settings.group')}>
        <Row
          label={translate('feature.review.settings.model')}
          description={translate('feature.review.settings.description')}
        >
          <SelectField
            aria-label={translate('feature.review.settings.model')}
            disabled={!state || saving}
            value={selectedValue}
            onValueChange={(value) => { void save(value); }}
          >
            <option value="">{translate('feature.review.settings.followCurrent')}</option>
            {!selectionAvailable ? (
              <option value={selectedValue} disabled>
                {translate('feature.review.settings.unavailable')}
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
          <Toast tone="info" message={translate('feature.review.settings.empty')} />
        ) : null}
        {error ? <Toast tone="error" message={error} /> : null}
      </Group>
    </Section>
  );
}

function referenceValue(reference: Readonly<{ providerId: string; modelId: string }>): string {
  return JSON.stringify([reference.providerId, reference.modelId]);
}

function modelOptionLabel(option: ReviewModelOption): string {
  const model = option.modelName && option.modelName !== option.modelCode
    ? `${option.modelName} (${option.modelCode})`
    : option.modelCode;
  return `${option.providerName} · ${model}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
