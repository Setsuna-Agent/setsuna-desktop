import { canFollowWorkspaceConversationDefaults, type WorkspaceConversationDefaults, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button, Disclosure } from '@setsuna-desktop/renderer-ui';
import { useRef } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SelectField } from '../../../shared/ui/primitives.js';
import { ProjectConversationOptionsFields } from './ProjectConversationOptionsFields.js';

export function ProjectConversationDefaultsFields({ value, projects, projectId, disabled, onChange }: Readonly<{
  value: WorkspaceConversationDefaults;
  projects: readonly WorkspaceProject[];
  projectId?: string;
  disabled: boolean;
  onChange(value: WorkspaceConversationDefaults): void;
}>) {
  const { t } = useI18n();
  const following = value.sourceProjectId !== undefined;
  // Keep both unsaved drafts while comparing modes; persist only the active one.
  const customDraft = useRef<WorkspaceConversationDefaults>(following ? {} : value);
  const sourceDraft = useRef(value.sourceProjectId ?? '');
  const sources = projects.filter((project) => canFollowWorkspaceConversationDefaults(projectId, project.id, projects));
  const sourceUnavailable = Boolean(value.sourceProjectId && !sources.some((project) => project.id === value.sourceProjectId));
  const changeMode = (mode: string) => {
    if (disabled || (mode === 'follow') === following) return;
    if (mode === 'follow') {
      customDraft.current = value;
      onChange({ sourceProjectId: sourceDraft.current });
    } else {
      sourceDraft.current = value.sourceProjectId ?? '';
      onChange(customDraft.current);
    }
  };
  return <Disclosure title={t('sidebar.conversationDefaults')}>
    <div className="desktop-project-editor__defaults-mode" data-following={following}
      role="group" aria-label={t('sidebar.conversationDefaults')}>
      <Button variant="ghost" aria-pressed={!following} disabled={disabled} onClick={() => changeMode('custom')}>
        {t('sidebar.customDefaults')}
      </Button>
      <Button variant="ghost" aria-pressed={following} disabled={disabled} onClick={() => changeMode('follow')}>
        {t('sidebar.followDefaults')}
      </Button>
    </div>
    {following ? <label className="desktop-project-editor__field">
      <span>{t('sidebar.defaultsSource')}</span>
      <SelectField aria-label={t('sidebar.defaultsSource')} value={value.sourceProjectId} disabled={disabled}
        onValueChange={(sourceProjectId) => onChange({ sourceProjectId })}>
        <option value="" disabled>{t('sidebar.chooseDefaultsSource')}</option>
        {sourceUnavailable ? <option value={value.sourceProjectId} disabled>{t('sidebar.unavailableDefaultsSource')}</option> : null}
        {sources.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </SelectField>
    </label> : <ProjectConversationOptionsFields value={value} disabled={disabled} onChange={onChange} />}
  </Disclosure>;
}
