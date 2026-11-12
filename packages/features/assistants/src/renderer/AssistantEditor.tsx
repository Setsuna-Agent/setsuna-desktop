import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, Trash2, UserRound } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, ConfirmDialog, Dialog, Tabs, TabsList, TabsTrigger, TextField, ToastNotice } from '@setsuna-desktop/renderer-ui';
import type { Assistant, AssistantsSnapshot } from '../contracts/index.js';
import type { AssistantsRendererService } from './client.js';
import { assistantForm, draftFromForm, type AssistantForm } from './form.js';
import type { AssistantsHostUi } from './host.js';
import { AssistantQqSection } from './AssistantQqSection.js';
import { AssistantQqGuide } from './AssistantQqGuide.js';
import { AssistantProfileSection } from './AssistantProfileSection.js';
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
  const [section, setSection] = useState('profile');
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
  const profileTabId = `${formId}-profile-tab`;
  const qqTabId = `${formId}-qq-tab`;
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
  return <><Dialog title={t(qqGuideOpen ? 'feature.assistants.qqGuide.title' : assistant ? 'feature.assistants.edit' : 'feature.assistants.create')} width={600} className="assistant-editor"
    onClose={qqGuideOpen ? () => setQqGuideOpen(false) : requestClose} dismissible={!busy && !confirmDiscard}
    footer={qqGuideOpen ? <Button autoFocus icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={() => setQqGuideOpen(false)}>{t('feature.assistants.back')}</Button> : <>
      {assistant ? <Button variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} className="assistant-editor__delete" disabled={busy} onClick={() => void deletion.remove(assistant.id)}>{t('feature.assistants.delete')}</Button> : null}
      <Button onClick={requestClose} disabled={busy}>{t('feature.assistants.cancel')}</Button>
      <Button variant="primary" type="submit" form={formId} disabled={avatarBusy} loading={busy}>{t('feature.assistants.save')}</Button>
    </>}>
    {/* Keep transient field state mounted while the guide is shown. */}
    <div ref={formPage} hidden={qqGuideOpen}>
      <form id={formId} className="assistant-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="assistant-profile-identity">
          <ui.AvatarField label={t('feature.assistants.avatar')} seed={assistant?.id} disabled={busy}
            onBusyChange={setAvatarBusy} value={{ avatar: form.avatar, avatarColor: form.avatarColor }}
            onChange={(value) => setForm((current) => ({ ...current, avatar: value.avatar, avatarColor: value.avatarColor }))} />
          <div className="sd-form-field assistant-profile-identity__name">
            <label className="sd-visually-hidden" htmlFor={nameId}>{t('feature.assistants.name')}</label>
            <TextField id={nameId} className="assistant-profile-name" disabled={busy} required maxLength={40} value={form.name}
              onChange={(event) => update('name', event.target.value)} />
          </div>
        </div>
        <Tabs value={section} onValueChange={setSection} variant="segment" className="assistant-editor__tabs">
          <TabsList aria-label={t('feature.assistants.info')}>
            <TabsTrigger id={profileTabId} value="profile" aria-controls={`${formId}-profile`} disabled={busy}>
              <UserRound size={14} aria-hidden="true" />{t('feature.assistants.title')}
            </TabsTrigger>
            <TabsTrigger id={qqTabId} value="qq" aria-controls={`${formId}-qq`} disabled={busy}>
              <MessageCircle size={14} aria-hidden="true" />{t('feature.assistants.qq')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {/* Switching sections keeps field drafts, uploaded avatars and revealed secrets in this editor. */}
        <div id={`${formId}-profile`} role="tabpanel" aria-labelledby={profileTabId} hidden={section !== 'profile'} className="assistant-editor__panel">
          <AssistantProfileSection form={form} snapshot={snapshot} ui={ui} busy={busy} translate={t} onChange={update} />
        </div>
        <div id={`${formId}-qq`} role="tabpanel" aria-labelledby={qqTabId} hidden={section !== 'qq'} className="assistant-editor__panel">
          <AssistantQqSection assistant={assistant} snapshot={snapshot} form={form} busy={busy} service={service} translate={t}
            onChange={update} onError={setError} onOpenGuide={openQqGuide} />
        </div>
      </form>
      {error ? <ToastNotice message={error} /> : null}
    </div>
    {qqGuideOpen ? <AssistantQqGuide translate={t} /> : null}
  </Dialog>
    <ConfirmDialog open={confirmDiscard} title={t('feature.assistants.discardTitle')}
      confirmLabel={t('feature.assistants.discard')} cancelLabel={t('feature.assistants.keepEditing')}
      danger onClose={() => setConfirmDiscard(false)} onConfirm={onClose} />
  </>;
}
