import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Checkbox, Disclosure, TextField } from '@setsuna-desktop/renderer-ui';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { useSkillsFeatureSnapshot } from '../../../composition/SkillsFeatureBoundary.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

export function ProjectDefaultSkillsField({ value = [], disabled, onChange }: Readonly<{
  value?: readonly string[];
  disabled: boolean;
  onChange(value: string[]): void;
}>) {
  const { t } = useI18n();
  const { skills } = useSkillsFeatureSnapshot();
  const [query, setQuery] = useState('');
  const selected = new Set(value);
  const choices: Pick<RuntimeSkillSummary, 'id' | 'name' | 'description'>[] = [
    ...skills.filter((skill) => skill.enabled || selected.has(skill.id)),
    ...value.filter((id) => !skills.some((skill) => skill.id === id)).map((id) => ({ id, name: id })),
  ];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSkills = choices.filter((skill) => (
    `${skill.name} ${skill.id} ${skill.description ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)
  ));

  return <Disclosure title={t('sidebar.defaultSkills')}>
    <p className="desktop-project-editor__notice" role="note"><Info size={16} aria-hidden="true" />
      <span>{t('sidebar.defaultSkillsNotice')}</span>
    </p>
    <TextField aria-label={t('capabilities.search.skills')} placeholder={t('capabilities.search.skills')}
      value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} />
    <div key={normalizedQuery} className="desktop-project-editor__skills-list">
      {visibleSkills.map((skill) => <Checkbox key={skill.id} checked={selected.has(skill.id)} disabled={disabled}
        onChange={(checked) => onChange(checked ? [...selected, skill.id] : value.filter((id) => id !== skill.id))}>
        {skill.name}
      </Checkbox>)}
    </div>
  </Disclosure>;
}
