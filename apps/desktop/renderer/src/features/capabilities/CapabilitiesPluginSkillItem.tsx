import type { RuntimePluginSkill, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function CapabilitiesPluginSkillItem({
  runtimeSkill,
  skill,
  onOpen,
  onSetEnabled,
}: {
  runtimeSkill?: RuntimeSkillSummary;
  skill: RuntimePluginSkill;
  onOpen: () => void;
  onSetEnabled?: (skill: RuntimeSkillSummary, enabled: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const removed = !runtimeSkill;

  const setEnabled = async (enabled: boolean) => {
    if (!runtimeSkill || !onSetEnabled) return;
    setPending(true);
    try {
      await onSetEnabled(runtimeSkill, enabled);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={`desktop-capabilities-plugin-detail__item desktop-capabilities-plugin-detail__skill-item${removed ? ' is-removed' : ''}`}>
      <button
        type="button"
        className="desktop-capabilities-plugin-detail__skill-open"
        aria-label={t('capabilities.detail.viewItem', { title: skill.name })}
        disabled={removed}
        onClick={onOpen}
      >
        <span className="desktop-capabilities-plugin-detail__item-icon"><BookOpen size={16} /></span>
        <span className="desktop-capabilities-plugin-detail__item-body">
          <strong>{skill.name}</strong>
          <small>{skill.description || t('capabilities.detail.skillFallback')}</small>
        </span>
      </button>
      <label
        className="sd-check"
        title={t(removed ? 'capabilities.detail.removedSkillHint' : 'capabilities.skill.enableHint')}
      >
        <input
          type="checkbox"
          aria-label={t('capabilities.detail.toggleSkill', { title: skill.name })}
          checked={runtimeSkill?.enabled ?? false}
          disabled={removed || pending || !onSetEnabled}
          onChange={(event) => void setEnabled(event.currentTarget.checked)}
        />
      </label>
    </div>
  );
}
