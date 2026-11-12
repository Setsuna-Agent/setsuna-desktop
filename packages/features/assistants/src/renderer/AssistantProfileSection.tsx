import { useId } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, MultiSelectField, SelectField, TextArea } from '@setsuna-desktop/renderer-ui';
import { ASSISTANT_PERSONALITY_LIMIT, type AssistantsSnapshot } from '../contracts/index.js';
import type { AssistantForm } from './form.js';
import type { AssistantsHostUi } from './host.js';

export function AssistantProfileSection({ form, snapshot, ui, busy, translate: t, onChange }: {
  form: AssistantForm; snapshot: AssistantsSnapshot; ui: AssistantsHostUi; busy: boolean; translate: RendererTranslate;
  onChange<K extends keyof AssistantForm>(key: K, value: AssistantForm[K]): void;
}) {
  const projectsId = useId();
  const model = snapshot.models.find((item) => item.providerId === form.modelSelection?.providerId && item.modelId === form.modelSelection?.modelId);
  const allProjectsSelected = snapshot.projects.length > 0 && snapshot.projects.every((project) => form.projectIds.includes(project.id));

  return <div className="sd-form-stack assistant-profile-fields">
    <label className="sd-form-field">
      <span className="sd-form-label">{t('feature.assistants.personality')}</span>
      <TextArea disabled={busy} rows={3} maxLength={ASSISTANT_PERSONALITY_LIMIT} value={form.personality}
        onChange={(event) => onChange('personality', event.target.value)} />
    </label>
    <div className="assistant-profile-fields__model">
      <div className="sd-form-field"><span className="sd-form-label">{t('feature.assistants.model')}</span>
        <ui.ModelPicker models={snapshot.models} value={form.modelSelection} disabled={busy} translate={t}
          onChange={(value) => { onChange('modelSelection', value); onChange('thinkingEffort', ''); }} />
      </div>
      <label className="sd-form-field"><span className="sd-form-label">{t('feature.assistants.effort')}</span>
        <SelectField disabled={busy} aria-label={t('feature.assistants.effort')} value={form.thinkingEffort} onValueChange={(effort) => onChange('thinkingEffort', effort)}>
          <option value="">{t('feature.assistants.noEffort')}</option>
          {(model?.thinkingEfforts ?? []).map((effort) => <option key={effort} value={effort}>{effort}</option>)}
        </SelectField>
      </label>
    </div>
    <div className="sd-form-field">
      <div className="sd-form-field-heading">
        <label className="sd-form-label" htmlFor={projectsId}>{t('feature.assistants.projects')}</label>
        {snapshot.projects.length ? <Button variant="ghost" size="small" disabled={busy}
          onClick={() => onChange('projectIds', allProjectsSelected ? [] : snapshot.projects.map((project) => project.id))}>
          {t(allProjectsSelected ? 'feature.assistants.projectsDeselectAll' : 'feature.assistants.projectsSelectAll')}
        </Button> : null}
      </div>
      <MultiSelectField id={projectsId} aria-label={t('feature.assistants.projects')} disabled={busy}
        value={form.projectIds} onValueChange={(value) => onChange('projectIds', value)}
        placeholder={t('feature.assistants.selectProjects')} searchPlaceholder={t('feature.assistants.searchProjects')}
        emptyLabel={t(snapshot.projects.length ? 'feature.assistants.noMatchingProjects' : 'feature.assistants.noProjects')}
        options={snapshot.projects.map((project) => ({ value: project.id, label: project.name, searchText: project.path,
          icon: <ui.ProjectIcon icon={project.icon} size={16} /> }))} />
    </div>
  </div>;
}
