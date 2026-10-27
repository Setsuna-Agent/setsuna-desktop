import type { SettingsSkillIconProps } from '@setsuna-desktop/renderer-contracts/settings';
import { WandSparkles } from 'lucide-react';

/** All Skills share the same glyph, including those supplied by Plugins. */
export function SkillIcon({
  className,
  variant = 'inline',
}: SettingsSkillIconProps) {
  return (
    <span
      className={[
        'desktop-skill-icon',
        `desktop-skill-icon--${variant}`,
        variant === 'inline' ? 'desktop-skill-icon--unframed' : undefined,
        className,
      ].filter(Boolean).join(' ')}
      data-skill-icon="skill"
      aria-hidden="true"
    >
      <WandSparkles strokeWidth={2} />
    </span>
  );
}
