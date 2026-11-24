import { Plus } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { isValidWorkspaceEntryName, WORKSPACE_ENTRY_EXISTS_ERROR_CODE } from '@setsuna-desktop/contracts';
import { FeatureOperationFailure, isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dialog, SelectField, TextField, useToast } from '@setsuna-desktop/renderer-ui';
import { designDocumentFileName, type DesignDirectory, type DesignWorkspace as DesignScope } from '../../contracts/index.js';
import { DesignLocationField } from './DesignLocationField.js';
import { DesignProjectIcon } from './DesignProjectIcon.js';
import type { DesignProject } from './DesignScopeFields.js';

export function DesignCreateDocument({ projects, defaultProjectId, onCreate, chooseDirectory, translate: t }: Readonly<{
  projects: readonly DesignProject[];
  defaultProjectId?: string;
  chooseDirectory(): Promise<DesignDirectory | null>;
  onCreate(scope: DesignScope, name: string, linkedProjectId?: string): Promise<void>;
  translate: RendererTranslate;
}>) {
  const [open, setOpen] = useState(false);
  const [directory, setDirectory] = useState<DesignDirectory | null>(null);
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const formId = useId();
  const nameId = useId();
  const locationId = useId();
  const projectIdField = useId();
  const errorId = useId();
  const toast = useToast();
  const label = t('feature.design.newDocument');
  const nameLabel = t('feature.design.name');
  const linkedProject = projects.find(({ id }) => id === projectId);

  function changeOpen(next: boolean) {
    if (submitting.current) return;
    if (next) { setDirectory(null); setName(''); setProjectId(defaultProjectId ?? ''); setError(undefined); }
    setOpen(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!isValidWorkspaceEntryName(name)) { setError(t('feature.design.invalidDocumentName')); return; }
    const fileName = designDocumentFileName(name);
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      await onCreate({ storageId: directory?.id ?? 'local' }, fileName, linkedProject?.id);
      setOpen(false);
    } catch (cause: unknown) {
      if (cause instanceof FeatureOperationFailure && cause.code === WORKSPACE_ENTRY_EXISTS_ERROR_CODE) {
        setError(t('feature.design.documentExists', { name: fileName }));
      } else if (!isFeatureOperationCancelled(cause)) {
        toast.error(t('feature.design.createDocumentFailed', { error: cause instanceof Error ? cause.message : String(cause) }));
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <>
    <Button variant="primary" size="large" icon={<Plus size={16} aria-hidden="true" />}
      aria-haspopup="dialog" onClick={() => changeOpen(true)}>{label}</Button>
    <Dialog open={open} title={label} width={420} onClose={() => changeOpen(false)} dismissible={!pending} footer={<>
      <Button disabled={pending} onClick={() => changeOpen(false)}>{t('feature.design.cancel')}</Button>
      <Button type="submit" variant="primary" form={formId} loading={pending} disabled={!name}>{label}</Button>
    </>}>
      <form id={formId} className="design-create-form" onSubmit={(event) => { void submit(event); }}>
        <div className="design-create-form__field">
          <label htmlFor={nameId}>{nameLabel}</label>
          <TextField id={nameId} autoFocus value={name} disabled={pending}
            aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
            onChange={(event) => { setName(event.currentTarget.value); setError(undefined); }}
            onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
          {error ? <span className="design-create-form__error" id={errorId} role="alert">{error}</span> : null}
        </div>
        <div className="design-create-form__field">
          <label htmlFor={locationId}>{t('feature.design.saveLocation')}</label>
          <DesignLocationField id={locationId} modal directory={directory} choose={chooseDirectory}
            onChange={(next) => { setDirectory(next); setError(undefined); }} disabled={pending} translate={t} />
        </div>
        <div className="design-create-form__field">
          <label htmlFor={projectIdField}>{t('feature.design.linkProject')}</label>
          <SelectField id={projectIdField} menuAlign="start" disabled={pending || projects.length === 0}
            renderOptionIcon={(id) => id ? <DesignProjectIcon icon={projects.find((project) => project.id === id)?.icon} /> : null}
            value={linkedProject?.id ?? ''} onValueChange={setProjectId}>
            <option value="">{t('feature.design.noLinkedProject')}</option>
            {projects.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </SelectField>
        </div>
      </form>
    </Dialog>
  </>;
}
