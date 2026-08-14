import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { CapabilitiesSkillListItem } from './CapabilitiesCatalogItems.js';

const skillGroups = [
  { kind: 'user', titleKey: 'capabilities.skill.catalog.user' },
  { kind: 'plugin', titleKey: 'capabilities.skill.catalog.plugin' },
  { kind: 'builtin', titleKey: 'capabilities.skill.catalog.builtin' },
] as const;

export function CapabilitiesSkillCatalog({
  skills,
  onOpen,
  onUpdate,
}: {
  skills: RuntimeSkillSummary[];
  onOpen: (skill: RuntimeSkillSummary) => void;
  onUpdate: (skill: RuntimeSkillSummary, patch: Pick<RuntimeSkillSummary, 'enabled'>) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="desktop-skill-catalog">
      {skillGroups.map((group) => {
        const groupSkills = skills.filter((skill) => skill.kind === group.kind);
        if (!groupSkills.length) return null;
        return (
          <section className="desktop-skill-catalog__section" key={group.kind}>
            <header>
              <h3>{t(group.titleKey)}</h3>
              <span>{groupSkills.length}</span>
            </header>
            <div className="desktop-capability-list">
              {groupSkills.map((skill) => (
                <CapabilitiesSkillListItem
                  key={skill.id}
                  skill={skill}
                  onOpen={() => onOpen(skill)}
                  onUpdate={(patch) => onUpdate(skill, patch)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
