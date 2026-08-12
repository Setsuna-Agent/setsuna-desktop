import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { BookOpen } from 'lucide-react';
import { PluginIcon } from './PluginIcon.js';

type SkillIconSource = Pick<RuntimeSkillSummary, 'icon' | 'kind' | 'pluginId'>;
type SkillIconVariant = 'inline' | 'list' | 'menu';

/** Keeps Plugin-owned Skills and ordinary Skills visually distinct across every surface. */
export function SkillIcon({
  className,
  skill,
  variant = 'inline',
}: {
  className?: string;
  skill?: SkillIconSource;
  variant?: SkillIconVariant;
}) {
  if (skill?.kind === 'plugin') {
    return (
      <PluginIcon
        className={className}
        name={skill.icon}
        pluginId={skill.pluginId}
        variant={variant}
      />
    );
  }

  return (
    <span
      className={[
        'desktop-skill-icon',
        `desktop-skill-icon--${variant}`,
        className,
      ].filter(Boolean).join(' ')}
      data-skill-icon="skill"
      aria-hidden="true"
    >
      <BookOpen strokeWidth={1.75} />
    </span>
  );
}
