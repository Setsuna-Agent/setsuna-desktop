import { useId, useState } from 'react';
import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { ChevronRight } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Checkbox, Dialog, SelectField, Switch, TextArea, TextField } from '@setsuna-desktop/renderer-ui';
import type { AutomationModel, AutomationProject, AutomationTask } from '../contracts/index.js';
import type { AutomationClient } from './client.js';
import { automationForm, draftFromForm, type AutomationForm } from './form.js';
import { ScheduleTimePicker } from './ScheduleTimePicker.js';
import type { AutomationRendererHost } from './host.js';

export function TaskEditor({ task, threadId, client, models, projects, ModelPicker, translate: t, onClose, onSaved }: {
  task?: AutomationTask; threadId: string; client: AutomationClient; models: AutomationModel[]; projects: AutomationProject[];
  ModelPicker: AutomationRendererHost['ModelPicker'];
  translate: RendererTranslate; onClose(): void; onSaved(task: AutomationTask): void;
}) {
  const [form, setForm] = useState(() => automationForm(task));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const update = <K extends keyof AutomationForm>(key: K, value: AutomationForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const selection = form.modelKey ? JSON.parse(form.modelKey) as RuntimeConfiguredModelReference : undefined;
  const model = models.find((item) => item.providerId === selection?.providerId && item.modelId === selection?.modelId);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const draft = draftFromForm(form);
      const saved = task ? await client.update(task.id, draft) : await client.create(threadId, draft);
      onSaved(saved); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog title={t(task ? 'feature.automation.edit' : 'feature.automation.createTitle')} onClose={onClose} dismissible={!busy} width={640} className="automation-editor"
    footer={<><Button onClick={onClose} disabled={busy}>{t('feature.automation.cancel')}</Button><Button variant="primary" type="submit" form={formId} loading={busy}>{t(task ? 'feature.automation.save' : 'feature.automation.create')}</Button></>}>
    <form id={formId} className="automation-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="automation-form__field"><span>{t('feature.automation.taskTitle')}</span><TextField required maxLength={120} value={form.title} onChange={(event) => update('title', event.target.value)} /></label>
      <label className="automation-form__field"><span>{t('feature.automation.prompt')}</span><TextArea required maxLength={32_000} rows={4} value={form.prompt} onChange={(event) => update('prompt', event.target.value)} /></label>
      <label className="automation-form__row"><span>{t('feature.automation.project')}</span><SelectField aria-label={t('feature.automation.project')} value={form.projectId ?? ''} onValueChange={(value) => update('projectId', value || null)}>
        <option value="">{t('feature.automation.noProject')}</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </SelectField></label>
      <label className="automation-form__row"><span>{t('feature.automation.repeat')}</span><SelectField aria-label={t('feature.automation.repeat')} value={form.kind}
        onValueChange={(kind) => setForm((current) => ({ ...current, kind: kind as AutomationForm['kind'], ...(kind === 'weekly' ? { weekdays: [current.weekdays[0] ?? 1] } : {}) }))}>
        {(['once', 'interval', 'daily', 'weekdays', 'weekly', 'custom'] as const).map((kind) => <option key={kind} value={kind}>{t(`feature.automation.${kind}`)}</option>)}
      </SelectField></label>
      {form.kind === 'interval' ? <label className="automation-form__row"><span>{t('feature.automation.minutes')}</span><TextField required type="number" min={1} max={525_600} value={form.minutes} onChange={(event) => update('minutes', Number(event.target.value))} /></label>
        : <div className="automation-form__row"><span>{t('feature.automation.time')}</span><ScheduleTimePicker value={form.kind === 'once' ? form.at : form.time} translate={t} onChange={(value) => update(form.kind === 'once' ? 'at' : 'time', value)} /></div>}
      {form.kind === 'weekly' || form.kind === 'custom' ? <div className="automation-form__days">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => <Checkbox key={day} checked={form.weekdays.includes(day)} onChange={(checked) => update('weekdays', form.kind === 'weekly' ? [day] : checked ? [...form.weekdays, day] : form.weekdays.filter((item) => item !== day))}>{t(`feature.automation.day.${day}`)}</Checkbox>)}
      </div> : null}
      <details className="automation-form__advanced"><summary><ChevronRight size={14} aria-hidden="true" />{t('feature.automation.advanced')}</summary>
        <div className="automation-form__row"><span>{t('feature.automation.newChat')}</span><Switch checked={form.newChat} label={t('feature.automation.newChat')} onCheckedChange={(value) => update('newChat', value)} /></div>
        <div className="automation-form__row"><span>{t('feature.automation.model')}</span>
          <ModelPicker models={models} value={selection} disabled={busy} translate={t}
            onChange={(value) => setForm((current) => ({ ...current, modelKey: value ? JSON.stringify(value) : '', thinkingEffort: '' }))} />
        </div>
        <label className="automation-form__row"><span>{t('feature.automation.effort')}</span><SelectField aria-label={t('feature.automation.effort')} value={form.thinkingEffort} onValueChange={(effort) => update('thinkingEffort', effort)}>
          <option value="">{t('feature.automation.noEffort')}</option>
          {(model?.thinkingEfforts ?? (form.thinkingEffort ? [form.thinkingEffort] : [])).map((effort) => <option key={effort} value={effort}>{effort}</option>)}
        </SelectField></label>
      </details>
      {error ? <p className="automation-error" role="alert">{error}</p> : null}
    </form>
  </Dialog>;
}
