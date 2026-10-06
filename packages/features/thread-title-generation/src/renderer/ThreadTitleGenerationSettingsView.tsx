import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { useEffect, useState } from 'react';
import type {
  ThreadTitleGenerationModelSelection,
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
  const { Group, Row, Section, ModelPicker, Toast } = ui;
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

  async function save(selection: ThreadTitleGenerationModelSelection) {
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
    <Section featureId="thread-title-generation">
      <Group title={translate('feature.threadTitleGeneration.settings.group')}>
        <Row
          label={translate('feature.threadTitleGeneration.settings.model')}
          description={translate('feature.threadTitleGeneration.settings.description')}
        >
          <ModelPicker
            aria-label={translate('feature.threadTitleGeneration.settings.model')}
            disabled={!state || saving}
            models={state?.availableModels ?? []}
            value={state?.selection ?? null}
            defaultLabel={translate('feature.threadTitleGeneration.settings.followCurrent')}
            unavailableLabel={translate('feature.threadTitleGeneration.settings.unavailable')}
            onChange={(selection) => { void save(selection); }}
          />
        </Row>
        {state && state.availableModels.length === 0 ? (
          <Toast tone="info" message={translate('feature.threadTitleGeneration.settings.empty')} />
        ) : null}
        {error ? <Toast tone="error" message={error} /> : null}
      </Group>
    </Section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
