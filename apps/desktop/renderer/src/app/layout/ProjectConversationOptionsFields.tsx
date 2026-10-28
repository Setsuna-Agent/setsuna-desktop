import type { WorkspaceConversationOptions } from '@setsuna-desktop/contracts';
import { Checkbox, Disclosure } from '@setsuna-desktop/renderer-ui';
import { Info } from 'lucide-react';
import { useConfiguredModelState } from '../../composition/ModelProviderFeatureBoundary.js';
import { useSkillsFeatureSnapshot } from '../../composition/SkillsFeatureBoundary.js';
import { chatDefaultModelSelection } from '../../features/chat/chatModelSelection.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ConfiguredModelPicker } from '../../shared/ui/model-picker/ConfiguredModelPicker.js';
import { modelOptions } from '../../shared/ui/model-picker/modelOptions.js';
import { SelectField } from '../../shared/ui/primitives.js';

export function ProjectConversationOptionsFields({ value, disabled, onChange }: Readonly<{
  value: WorkspaceConversationOptions;
  disabled: boolean;
  onChange(value: WorkspaceConversationOptions): void;
}>) {
  const { t } = useI18n();
  const state = useConfiguredModelState();
  const { skills } = useSkillsFeatureSnapshot();
  const model = value.model
    ? state?.providers.find((provider) => provider.enabled && provider.id === value.model?.providerId)?.models.find((model) => model.id === value.model?.modelId)
    : chatDefaultModelSelection(state).model;
  const selected = new Set(value.skillIds);
  const choices = [...skills.filter((skill) => skill.enabled || selected.has(skill.id)),
    ...[...selected].filter((id) => !skills.some((skill) => skill.id === id)).map((id) => ({ id, name: id }))];

  return <>
    <label className="desktop-project-editor__field">
      <span>{t('sidebar.defaultModel')}</span>
      <ConfiguredModelPicker options={modelOptions(state)} aria-label={t('sidebar.defaultModel')} value={value.model ?? null}
        defaultLabel={t('sidebar.inheritDefault')} unavailableLabel={t('sidebar.unavailableDefault')} disabled={disabled || !state}
        onChange={(model) => onChange({ ...value, model: model ?? undefined, thinking: undefined })} />
    </label>
    <label className="desktop-project-editor__field">
      <span>{t('sidebar.defaultThinking')}</span>
      <SelectField aria-label={t('sidebar.defaultThinking')}
        value={!model?.thinkingEnabled || !value.thinking ? 'inherit' : value.thinking.enabled ? value.thinking.effort || 'enabled' : 'off'}
        disabled={disabled || !model?.thinkingEnabled}
        onValueChange={(effort) => onChange({ ...value, thinking: effort === 'inherit' ? undefined
          : { enabled: effort !== 'off', effort: effort === 'off' || effort === 'enabled' ? '' : effort } })}>
        <option value="inherit">{t(model && !model.thinkingEnabled ? 'sidebar.thinkingUnsupported' : 'sidebar.inheritDefault')}</option>
        <option value="off">{t('sidebar.thinkingOff')}</option>
        {(model?.thinkingEfforts?.length ? model.thinkingEfforts : ['enabled']).map((effort) =>
          <option key={effort} value={effort}>{effort === 'enabled' ? t('sidebar.thinkingOn') : effort}</option>)}
      </SelectField>
    </label>
    <Disclosure title={t('sidebar.defaultSkills')}>
      <p className="desktop-project-editor__notice" role="note"><Info size={16} aria-hidden="true" />
        <span>{t('sidebar.defaultSkillsNotice')}</span>
      </p>
      {choices.map((skill) => <Checkbox key={skill.id} checked={selected.has(skill.id)} disabled={disabled}
        onChange={(checked) => onChange({ ...value, skillIds: checked ? [...selected, skill.id] : [...selected].filter((id) => id !== skill.id) })}>
        {skill.name}
      </Checkbox>)}
    </Disclosure>
  </>;
}
