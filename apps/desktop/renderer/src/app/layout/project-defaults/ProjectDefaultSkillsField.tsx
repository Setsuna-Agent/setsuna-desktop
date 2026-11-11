import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { MultiSelectField } from '@setsuna-desktop/renderer-ui';
import { useId } from 'react';
import { useSkillsFeatureSnapshot } from '../../../composition/SkillsFeatureBoundary.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

export function ProjectDefaultSkillsField({ value = [], disabled, onChange }: Readonly<{
  value?: readonly string[];
  disabled: boolean;
  onChange(value: string[]): void;
}>) {
  const { t } = useI18n();
  const { skills } = useSkillsFeatureSnapshot();
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const selected = new Set(value);
  const choices: Pick<RuntimeSkillSummary, 'id' | 'name' | 'description'>[] = [
    ...skills.filter((skill) => skill.enabled || selected.has(skill.id)),
    ...value.filter((id) => !skills.some((skill) => skill.id === id)).map((id) => ({ id, name: id })),
  ];
  return <div className="sd-form-field">
    <div className="sd-form-field-heading">
      <label className="sd-form-label" htmlFor={fieldId}>{t('sidebar.defaultSkills')}</label>
      <span id={hintId} className="desktop-project-editor__field-hint">{t('sidebar.defaultSkillsNotice')}</span>
    </div>
    <MultiSelectField id={fieldId} aria-label={t('sidebar.defaultSkills')} aria-describedby={hintId} disabled={disabled}
      value={value} onValueChange={onChange}
      options={choices.map((skill) => ({ value: skill.id, label: skill.name, searchText: skill.description }))}
      placeholder={t('sidebar.selectDefaultSkills')} searchPlaceholder={t('capabilities.search.skills')}
      emptyLabel={t('sidebar.noMatchingSkills')} />
  </div>;
}
