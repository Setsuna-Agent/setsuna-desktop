import type { WorkspaceConversationOptions } from '@setsuna-desktop/contracts';
import { useConfiguredModelState } from '../../../composition/ModelProviderFeatureBoundary.js';
import { chatDefaultModelSelection } from '../../../features/chat/chatModelSelection.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { ConfiguredModelPicker } from '../../../shared/ui/model-picker/ConfiguredModelPicker.js';
import { modelOptions } from '../../../shared/ui/model-picker/modelOptions.js';
import { SelectField } from '../../../shared/ui/primitives.js';
import { ProjectDefaultSkillsField } from './ProjectDefaultSkillsField.js';

export function ProjectConversationOptionsFields({ value, disabled, onChange }: Readonly<{
  value: WorkspaceConversationOptions;
  disabled: boolean;
  onChange(value: WorkspaceConversationOptions): void;
}>) {
  const { t } = useI18n();
  const state = useConfiguredModelState();
  const model = value.model
    ? state?.providers.find((provider) => provider.enabled && provider.id === value.model?.providerId)?.models.find((model) => model.id === value.model?.modelId)
    : chatDefaultModelSelection(state).model;

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
    <ProjectDefaultSkillsField value={value.skillIds} disabled={disabled}
      onChange={(skillIds) => onChange({ ...value, skillIds })} />
  </>;
}
