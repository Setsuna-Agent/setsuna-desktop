import type { RuntimeSkillDetail, RuntimeSkillInput } from '@setsuna-desktop/contracts';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { Button, PageHeader, TextArea, TextField } from '../../shared/ui/primitives.js';

type SkillEditorDraft = {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  selected: boolean;
};

export function CapabilitiesSkillEditor({
  mode,
  saving,
  skill,
  onBack,
  onSave,
}: {
  mode: 'create' | 'edit';
  saving: boolean;
  skill?: RuntimeSkillDetail | null;
  onBack: () => void;
  onSave: (input: RuntimeSkillInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SkillEditorDraft>(() => createDraft(skill));

  useEffect(() => {
    setDraft(createDraft(skill));
  }, [skill]);

  const creating = mode === 'create';
  const setEnabled = (enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      enabled,
      selected: enabled ? current.selected : false,
    }));
  };
  return (
    <section className="desktop-capabilities-detail desktop-capabilities-skill-editor">
      <PageHeader
        onBack={onBack}
        title={creating ? t('capabilities.skill.editor.create') : skill?.name || t('capabilities.skill.editor.edit')}
        subtitle={t(creating ? 'capabilities.skill.editor.createSubtitle' : 'capabilities.skill.editor.editSubtitle')}
        actions={
          <Button
            type="button"
            variant="primary"
            icon={<Save size={14} />}
            disabled={saving || !draft.name.trim() || !draft.content.trim()}
            onClick={() => void onSave(toInput(draft, creating))}
          >
            {saving ? t('capabilities.common.saving') : t('common.save')}
          </Button>
        }
      />

      <div className="desktop-capabilities-skill-form">
        <label>
          <span>{t('capabilities.skill.editor.name')}</span>
          <TextField value={draft.name} onChange={(event) => setDraftField(setDraft, 'name', event.target.value)} placeholder={t('capabilities.skill.editor.namePlaceholder')} />
        </label>
        <label>
          <span>{t('capabilities.skill.editor.id')}</span>
          <TextField
            value={draft.id}
            disabled={!creating}
            onChange={(event) => setDraftField(setDraft, 'id', event.target.value)}
            placeholder={t('capabilities.skill.editor.idPlaceholder')}
          />
        </label>
        <label className="desktop-capabilities-skill-form__full">
          <span>{t('capabilities.skill.editor.description')}</span>
          <TextArea value={draft.description} onChange={(event) => setDraftField(setDraft, 'description', event.target.value)} placeholder={t('capabilities.skill.editor.descriptionPlaceholder')} />
        </label>
        <label className="desktop-capabilities-skill-form__full">
          <span>SKILL.md</span>
          <TextArea
            className="desktop-capabilities-skill-form__content"
            value={draft.content}
            onChange={(event) => setDraftField(setDraft, 'content', event.target.value)}
            placeholder={t('capabilities.skill.editor.contentPlaceholder')}
            spellCheck={false}
          />
        </label>
        <div className="desktop-capabilities-skill-form__checks">
          <label className="sd-check" title={t('capabilities.skill.enableHint')}>
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />
            <span>{t('capabilities.skill.enabled')}</span>
          </label>
          <label className="sd-check" title={t('capabilities.skill.defaultHint')}>
            <input type="checkbox" checked={draft.selected} disabled={!draft.enabled} onChange={(event) => setDraftField(setDraft, 'selected', event.currentTarget.checked)} />
            <span>{t('capabilities.skill.editor.default')}</span>
          </label>
        </div>
        <p className="desktop-capabilities-skill-usage-help desktop-capabilities-skill-form__full">
          {t('capabilities.skill.editor.defaultDescription')}
        </p>
      </div>
    </section>
  );
}

function createDraft(skill?: RuntimeSkillDetail | null): SkillEditorDraft {
  return {
    id: skill?.id ?? '',
    name: skill?.name ?? '',
    description: skill?.description ?? '',
    content: skill?.content ?? '',
    enabled: skill?.enabled ?? true,
    selected: skill?.selected ?? false,
  };
}

function toInput(draft: SkillEditorDraft, includeId: boolean): RuntimeSkillInput {
  return {
    ...(includeId && draft.id.trim() ? { id: draft.id.trim() } : {}),
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    content: draft.content.trim(),
    enabled: draft.enabled,
    selected: draft.enabled && draft.selected,
  };
}

function setDraftField<TKey extends keyof SkillEditorDraft>(
  setDraft: (updater: (draft: SkillEditorDraft) => SkillEditorDraft) => void,
  key: TKey,
  value: SkillEditorDraft[TKey],
) {
  setDraft((draft) => ({ ...draft, [key]: value }));
}
