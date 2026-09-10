import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { ReviewClient } from './client.js';
import { useGitSettings } from './git/useGitSettings.js';
import { ReviewModelSelect } from './ReviewModelSelect.js';

/** Both selectors share the current revision, including after either model is saved. */
export function GitTaskModelSettings({ client, translate: t, ui }: {
  client: Pick<ReviewClient, 'readGitSettings' | 'updateGitSettings'>;
  translate: RendererTranslate;
  ui: Pick<SettingsViewUi, 'Group' | 'Row' | 'Section' | 'SelectField' | 'Toast' | 'Button'>;
}) {
  const { draft, setDraft, ready, pending, availableModels, error, load, save } = useGitSettings(client);
  const { Group, Row, Section, SelectField, Toast, Button } = ui;
  return (
    <Section featureId="desktop-review">
      <Group title={t('feature.review.settings.commitMessageGroup')}>
        {(['commitMessageModel', 'conflictResolutionModel'] as const).map((key) => {
          const label = t(key === 'commitMessageModel' ? 'feature.review.settings.commitMessageModel' : 'feature.review.settings.conflictModel');
          return (
            <Row key={key} label={label} description={t(key === 'commitMessageModel' ? 'feature.review.settings.commitMessageDescription' : 'feature.review.settings.conflictDescription')}>
              <ReviewModelSelect SelectField={SelectField} translate={t} label={label} models={availableModels}
                selection={draft[key]} disabled={!ready || pending !== null || error === 'conflict'} onChange={(selection) => {
                  const next = { ...draft, [key]: selection };
                  setDraft(next);
                  void save(next);
                }} />
            </Row>
          );
        })}
        {ready && availableModels.length === 0 ? <Toast tone="info" message={t('feature.review.settings.empty')} /> : null}
        {error ? (
          <>
            <Toast tone="error" message={t(error === 'conflict' ? 'feature.review.git.settingsConflict' : error === 'load' ? 'feature.review.git.settingsLoadFailed' : 'feature.review.git.settingsSaveFailed')} />
            <Button disabled={pending !== null} onClick={() => { void load(); }}>{t('feature.review.git.promptReload')}</Button>
          </>
        ) : null}
      </Group>
    </Section>
  );
}
