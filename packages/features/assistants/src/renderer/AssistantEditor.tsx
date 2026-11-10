import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Checkbox, ConfirmDialog, Dialog, SelectField, TextArea, TextField, ToastNotice } from '@setsuna-desktop/renderer-ui';
import { ASSISTANT_PERSONALITY_LIMIT, type Assistant, type AssistantsSnapshot } from '../contracts/index.js';
import type { AssistantsRendererService } from './client.js';
import { assistantForm, draftFromForm, type AssistantForm } from './form.js';
import type { AssistantsHostUi } from './host.js';
import { AssistantQqSection } from './AssistantQqSection.js';
import { AssistantQqGuide } from './AssistantQqGuide.js';
import { errorMessage } from './errors.js';
import { useAssistantDeletion } from './useAssistantDeletion.js';

export function AssistantEditor({ assistant, snapshot, service, ui, translate: t, onClose, onSaved, onDeleted }: {
  assistant?: Assistant; snapshot: AssistantsSnapshot; service: AssistantsRendererService; ui: AssistantsHostUi;
  translate: RendererTranslate; onClose(): void; onSaved(assistant: Assistant): void; onDeleted(): void;
}) {
  const [form, setForm] = useState(() => assistantForm(assistant));
  const initialForm = useRef(form);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [qqGuideOpen, setQqGuideOpen] = useState(false);
  const formPage = useRef<HTMLDivElement>(null);
  const guideTrigger = useRef<HTMLButtonElement | null>(null);
  const formScrollTop = useRef(0);
  const persisted = useRef(assistant);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const deletion = useAssistantDeletion({ client: service.client, translate: t, onDeleted, onError: setError });
  const busy = saving || deletion.busy;
  const formId = useId();
  const nameId = `${formId}-name`;
  const openQqGuide = (trigger: HTMLButtonElement) => {
    guideTrigger.current = trigger;
    formScrollTop.current = formPage.current?.parentElement?.scrollTop ?? 0;
    setQqGuideOpen(true);
  };
  // Both pages share the dialog's scroll surface; returning restores the user's editing position.
  useLayoutEffect(() => {
    const scrollSurface = formPage.current?.parentElement;
    if (scrollSurface) scrollSurface.scrollTop = qqGuideOpen ? 0 : formScrollTop.current;
    if (!qqGuideOpen) guideTrigger.current?.focus({ preventScroll: true });
  }, [qqGuideOpen]);
  const update = <K extends keyof AssistantForm>(key: K, value: AssistantForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const model = snapshot.models.find((item) => item.providerId === form.modelSelection?.providerId && item.modelId === form.modelSelection?.modelId);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true); setError(null);
    try { await action(); } catch (cause) { setError(errorMessage(cause)); } finally { pending.current = false; setSaving(false); }
  };
  const requestClose = () => {
    if (busy) return;
    if (JSON.stringify(form) !== JSON.stringify(initialForm.current)) setConfirmDiscard(true);
    else onClose();
  };
  const save = () => avatarBusy ? Promise.resolve() : run(async () => {
    const draft = draftFromForm(form);
    const saved = persisted.current ? await service.client.update(persisted.current.id, draft) : await service.client.create(draft);
    // Retain the identity if secret storage fails, so retrying cannot create a second assistant.
    persisted.current = saved;
    // The secret is stored separately in the OS secret store, after the assistant exists.
    if (form.qqSecret.trim()) await service.client.setQqSecret(saved.id, form.qqSecret.trim());
    onSaved(saved);
  });
  const toggleProject = (projectId: string, checked: boolean) => update('projectIds', checked
    ? [...form.projectIds, projectId] : form.projectIds.filter((id) => id !== projectId));
  const allProjectsSelected = snapshot.projects.length > 0 && snapshot.projects.every((project) => form.projectIds.includes(project.id));

  return <><Dialog title={t(qqGuideOpen ? 'feature.assistants.qqGuide.title' : assistant ? 'feature.assistants.edit' : 'feature.assistants.create')} width={600} className="assistant-editor"
    onClose={qqGuideOpen ? () => setQqGuideOpen(false) : requestClose} dismissible={!busy && !confirmDiscard}
    footer={qqGuideOpen ? <Button autoFocus icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={() => setQqGuideOpen(false)}>{t('feature.assistants.back')}</Button> : <>
      {assistant ? <Button variant="danger" className="assistant-editor__delete" disabled={busy} onClick={() => void deletion.remove(assistant.id)}>{t('feature.assistants.delete')}</Button> : null}
      <Button onClick={requestClose} disabled={busy}>{t('feature.assistants.cancel')}</Button>
      <Button variant="primary" type="submit" form={formId} disabled={avatarBusy} loading={busy}>{t('feature.assistants.save')}</Button>
    </>}>
    {/* Keep transient field state mounted while the guide is shown. */}
    <div ref={formPage} hidden={qqGuideOpen}>
      <form id={formId} className="assistant-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="assistant-form__field">
          <label htmlFor={nameId}>{t('feature.assistants.name')}</label>
          <TextField id={nameId} disabled={busy} required maxLength={40} value={form.name}
            onChange={(event) => update('name', event.target.value)}
            leadingControl={<ui.AvatarField label={t('feature.assistants.avatar')} seed={assistant?.id} disabled={busy}
              onBusyChange={setAvatarBusy} value={{ avatar: form.avatar, avatarColor: form.avatarColor }}
              onChange={(value) => setForm((current) => ({ ...current, avatar: value.avatar, avatarColor: value.avatarColor }))} />} />
        </div>
        <label className="assistant-form__field">
          <span>{t('feature.assistants.personality')}</span>
          <TextArea disabled={busy} rows={3} maxLength={ASSISTANT_PERSONALITY_LIMIT} value={form.personality}
            onChange={(event) => update('personality', event.target.value)} />
        </label>
        <div className="assistant-form__group">
          <div className="assistant-form__row"><span>{t('feature.assistants.model')}</span>
            <ui.ModelPicker models={snapshot.models} value={form.modelSelection} disabled={busy} translate={t}
              onChange={(value) => setForm((current) => ({ ...current, modelSelection: value, thinkingEffort: '' }))} />
          </div>
          <label className="assistant-form__row"><span>{t('feature.assistants.effort')}</span>
            <SelectField disabled={busy} aria-label={t('feature.assistants.effort')} value={form.thinkingEffort} onValueChange={(effort) => update('thinkingEffort', effort)}>
              <option value="">{t('feature.assistants.noEffort')}</option>
              {(model?.thinkingEfforts ?? []).map((effort) => <option key={effort} value={effort}>{effort}</option>)}
            </SelectField>
          </label>
        </div>
        <fieldset className="assistant-form__projects" disabled={busy}>
          <legend>
            <span>{t('feature.assistants.projects')}</span>
            {snapshot.projects.length ? <Button variant="ghost" size="small" type="button" disabled={busy}
              onClick={() => update('projectIds', allProjectsSelected ? [] : snapshot.projects.map((project) => project.id))}>
              {t(allProjectsSelected ? 'feature.assistants.projectsDeselectAll' : 'feature.assistants.projectsSelectAll')}
            </Button> : null}
          </legend>
          {snapshot.projects.length ? <div className="assistant-form__project-options">
            {snapshot.projects.map((project) => (
              <Checkbox key={project.id} className="assistant-form__project" disabled={busy}
                checked={form.projectIds.includes(project.id)} onChange={(checked) => toggleProject(project.id, checked)}>
                <span className="assistant-form__project-name" title={project.path}>{project.name}</span>
              </Checkbox>
            ))}
          </div> : <span className="assistant-form__empty">{t('feature.assistants.noProjects')}</span>}
        </fieldset>
        <AssistantQqSection assistant={assistant} snapshot={snapshot} form={form} busy={busy} service={service} translate={t}
          onChange={update} onError={setError} onOpenGuide={openQqGuide} />
        {error ? <ToastNotice message={error} /> : null}
      </form>
    </div>
    {qqGuideOpen ? <AssistantQqGuide translate={t} /> : null}
  </Dialog>
    <ConfirmDialog open={confirmDiscard} title={t('feature.assistants.discardTitle')}
      confirmLabel={t('feature.assistants.discard')} cancelLabel={t('feature.assistants.keepEditing')}
      danger onClose={() => setConfirmDiscard(false)} onConfirm={onClose} />
  </>;
}
