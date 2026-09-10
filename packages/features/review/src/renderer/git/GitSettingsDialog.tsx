import { TextArea, Button } from '@setsuna-desktop/renderer-ui';

import { useId } from 'react';
import { GitMerge, Settings, Sparkles } from 'lucide-react';
import { DEFAULT_COMMIT_MESSAGE_PROMPT, DEFAULT_CONFLICT_RESOLUTION_PROMPT, MAX_COMMIT_MESSAGE_PROMPT_CHARS } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { ReviewModelSelect } from '../ReviewModelSelect.js';
import { useGitSettings } from './useGitSettings.js';

export function GitSettingsDialog({ onClose }: { onClose: () => void }) {
  const { translate: t, ui: { Dialog, SelectField, Toggle } } = useReviewRendererHost();
  const { draft, setDraft, ready, pending, error, load, save, availableModels } = useGitSettings();
  const busy = pending !== null;
  const disabled = !ready || busy;
  const close = () => { if (pending !== 'saving') onClose(); };
  return (
    <Dialog title={t('feature.review.git.settingsTitle')} titleIcon={<Settings size={18} />}
      subtitle={t('feature.review.git.settingsDescription')} closeLabel={t('common.cancel')} onClose={close}
      footer={(
        <div className="git-settings__actions">
          <Button variant="ghost" type="button" disabled={pending === 'saving'} onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" type="button" disabled={disabled || !draft.commitMessagePrompt.trim() || !draft.conflictResolutionPrompt.trim() || error === 'conflict'} onClick={() => { void save().then((saved) => { if (saved) onClose(); }); }}>
            {t(pending === 'saving' ? 'feature.review.git.promptSaving' : 'feature.review.git.promptSave')}
          </Button>
        </div>
      )}
    >
      <div className="git-settings__body" aria-busy={busy}>
        <section className="git-settings__section">
          <h3><Sparkles size={15} />{t('feature.review.git.commitMessageSection')}</h3>
          <div className="git-settings__model-row">
            <span>{t('feature.review.settings.commitMessageModel')}</span>
            <ReviewModelSelect SelectField={SelectField} translate={t} label={t('feature.review.settings.commitMessageModel')}
              disabled={disabled} selection={draft.commitMessageModel} models={availableModels}
              onChange={(commitMessageModel) => setDraft((current) => ({ ...current, commitMessageModel }))} />
          </div>
          <PromptField label={t('feature.review.git.promptLabel')} value={draft.commitMessagePrompt} disabled={disabled}
            defaultValue={DEFAULT_COMMIT_MESSAGE_PROMPT} description={t('feature.review.git.promptDescription')}
            onChange={(commitMessagePrompt) => setDraft((current) => ({ ...current, commitMessagePrompt }))} />
        </section>
        <section className="git-settings__section">
          <h3><GitMerge size={15} />{t('feature.review.git.conflictSection')}</h3>
          <Toggle checked={draft.autoResolveConflicts} disabled={disabled}
            label={t('feature.review.git.autoResolveConflicts')} description={t('feature.review.git.autoResolveDescription')}
            onChange={(autoResolveConflicts) => setDraft((current) => ({ ...current, autoResolveConflicts, conflictResolutionPrompt: current.conflictResolutionPrompt.trim() ? current.conflictResolutionPrompt : DEFAULT_CONFLICT_RESOLUTION_PROMPT }))} />
          {draft.autoResolveConflicts ? (
            <>
              <div className="git-settings__model-row">
                <span>{t('feature.review.settings.conflictModel')}</span>
                <ReviewModelSelect SelectField={SelectField} translate={t} label={t('feature.review.settings.conflictModel')}
                  disabled={disabled} selection={draft.conflictResolutionModel} models={availableModels}
                  onChange={(conflictResolutionModel) => setDraft((current) => ({ ...current, conflictResolutionModel }))} />
              </div>
              <PromptField label={t('feature.review.git.conflictPrompt')} value={draft.conflictResolutionPrompt} disabled={disabled}
                defaultValue={DEFAULT_CONFLICT_RESOLUTION_PROMPT} description={t('feature.review.git.conflictPromptDescription')}
                onChange={(conflictResolutionPrompt) => setDraft((current) => ({ ...current, conflictResolutionPrompt }))} />
            </>
          ) : null}
        </section>
        {pending === 'loading' ? <span role="status">{t('feature.review.git.settingsLoading')}</span> : null}
        {error ? (
          <div className="git-settings__error" role="alert">
            <span>{t(error === 'conflict' ? 'feature.review.git.settingsConflict' : error === 'load' ? 'feature.review.git.settingsLoadFailed' : 'feature.review.git.settingsSaveFailed')}</span>
            {error !== 'save' ? <Button variant="ghost" type="button" disabled={busy} onClick={() => { void load(); }}>{t('feature.review.git.promptReload')}</Button> : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function PromptField({ label, description, value, defaultValue, disabled, onChange }: {
  label: string; description: string; value: string; defaultValue: string; disabled: boolean; onChange(value: string): void;
}) {
  const id = useId();
  const { translate: t } = useReviewRendererHost();
  return (
    <div className="git-settings__prompt">
      <div className="git-settings__prompt-heading">
        <label htmlFor={id}>{label}</label>
        <Button variant="ghost" type="button" disabled={disabled || value === defaultValue} onClick={() => onChange(defaultValue)}>{t('feature.review.git.promptReset')}</Button>
      </div>
      <TextArea id={id} aria-describedby={`${id}-description`} className="git-settings__input" rows={5}
        maxLength={MAX_COMMIT_MESSAGE_PROMPT_CHARS} disabled={disabled} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      <small id={`${id}-description`}>{description}</small>
    </div>
  );
}
