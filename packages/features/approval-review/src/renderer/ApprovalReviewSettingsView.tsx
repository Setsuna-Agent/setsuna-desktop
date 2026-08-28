import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { useEffect, useState } from 'react';
import type {
  ApprovalReviewModelOption,
  ApprovalReviewSettingsState,
} from '../contracts/index.js';
import type { ApprovalReviewClient } from './client.js';

export function ApprovalReviewSettingsView({
  client,
  translate,
  ui,
}: Readonly<{
  client: ApprovalReviewClient;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { Group, Row, Section, SelectField, Toast } = ui;
  const [state, setState] = useState<ApprovalReviewSettingsState | null>(null);
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
    <Section featureId="approval-review">
      <Group title={translate('feature.approvalReview.settings.group')}>
        <Row
          label={translate('feature.approvalReview.settings.model')}
          description={translate('feature.approvalReview.settings.description')}
        >
          <SelectField
            aria-label={translate('feature.approvalReview.settings.model')}
            disabled={!state || saving}
            value={selectedValue}
            onValueChange={(value) => { void save(value); }}
          >
            <option value="">{translate('feature.approvalReview.settings.followCurrent')}</option>
            {!selectionAvailable ? (
              <option value={selectedValue} disabled>
                {translate('feature.approvalReview.settings.unavailable')}
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
          <Toast tone="info" message={translate('feature.approvalReview.settings.empty')} />
        ) : null}
        {error ? <Toast tone="error" message={error} /> : null}
      </Group>
    </Section>
  );
}

function referenceValue(reference: Readonly<{ providerId: string; modelId: string }>): string {
  return JSON.stringify([reference.providerId, reference.modelId]);
}

function modelOptionLabel(option: ApprovalReviewModelOption): string {
  const model = option.modelName && option.modelName !== option.modelCode
    ? `${option.modelName} (${option.modelCode})`
    : option.modelCode;
  return `${option.providerName} · ${model}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
