import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { useEffect, useState } from 'react';
import type {
  ApprovalReviewModelSelection,
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
  const { Group, Row, Section, ModelPicker, Toast } = ui;
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

  async function save(selection: ApprovalReviewModelSelection) {
    if (!state) return;
    setSaving(true);
    setError(null);
    try {
      setState(await client.updateSettings({
        expectedRevision: state.revision,
        selection,
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
          <ModelPicker
            aria-label={translate('feature.approvalReview.settings.model')}
            disabled={!state || saving}
            models={state?.availableModels ?? []}
            value={state?.selection ?? null}
            defaultLabel={translate('feature.approvalReview.settings.followCurrent')}
            unavailableLabel={translate('feature.approvalReview.settings.unavailable')}
            onChange={(selection) => { void save(selection); }}
          />
        </Row>
        {state && state.availableModels.length === 0 ? (
          <Toast tone="info" message={translate('feature.approvalReview.settings.empty')} />
        ) : null}
        {error ? <Toast tone="error" message={error} /> : null}
      </Group>
    </Section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
