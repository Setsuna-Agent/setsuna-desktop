import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { useEffect, useState } from 'react';
import type {
  ReviewModelSelection,
  ReviewSettingsState,
} from '../contracts/index.js';
import type { ReviewClient } from './client.js';
import { ReviewModelSelect } from './ReviewModelSelect.js';
import type { ReviewMessageKey } from './messages.js';

export function ReviewSettingsView({
  client,
  translate,
  ui,
  groupKey = 'feature.review.settings.group',
  modelKey = 'feature.review.settings.model',
  descriptionKey = 'feature.review.settings.description',
}: Readonly<{
  client: Pick<ReviewClient, 'readSettings' | 'updateSettings'>;
  translate: RendererTranslate;
  ui: SettingsViewUi;
  groupKey?: ReviewMessageKey;
  modelKey?: ReviewMessageKey;
  descriptionKey?: ReviewMessageKey;
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

  async function save(selection: ReviewModelSelection) {
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
    <Section featureId="desktop-review">
      <Group title={translate(groupKey)}>
        <Row
          label={translate(modelKey)}
          description={translate(descriptionKey)}
        >
          <ReviewModelSelect SelectField={SelectField} translate={translate} label={translate(modelKey)}
            disabled={!state || saving} selection={state?.selection ?? null} models={state?.availableModels ?? []}
            onChange={(selection) => { void save(selection); }} />
        </Row>
        {state && state.availableModels.length === 0 ? (
          <Toast tone="info" message={translate('feature.review.settings.empty')} />
        ) : null}
        {error ? <Toast tone="error" message={error} /> : null}
      </Group>
    </Section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
