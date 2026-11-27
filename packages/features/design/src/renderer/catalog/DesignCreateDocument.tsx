import { Plus, Upload } from 'lucide-react';
import { forwardRef, useId, useImperativeHandle, useRef, useState, type FormEvent } from 'react';
import { isValidWorkspaceEntryName, WORKSPACE_ENTRY_EXISTS_ERROR_CODE, WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES } from '@setsuna-desktop/contracts';
import { FeatureOperationFailure, isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dialog, SelectField, TextField, useToast } from '@setsuna-desktop/renderer-ui';
import { designDocumentFileName, isDesignPackageFolderName, type CreateDesignDocumentInput, type DesignDirectory,
  type DesignPackageDestination, type DesignWorkspace as DesignScope } from '../../contracts/index.js';
import type { DesignFontClient } from '../client.js';
import { designImportSource, type DesignImportSource } from '../import/design-import.js';
import { DesignLocationField } from './DesignLocationField.js';
import { DesignProjectIcon } from './DesignProjectIcon.js';
import type { DesignProject } from './DesignScopeFields.js';

type NewDesignDraft = Pick<CreateDesignDocumentInput, 'name' | 'linkedProjectId' | 'initialLayers'>;

export type DesignCreateDocumentHandle = Readonly<{ openImport(source: DesignImportSource): void }>;

type DesignCreateDocumentProps = Readonly<{
  projects: readonly DesignProject[];
  defaultProjectId?: string;
  chooseDirectory(): Promise<DesignDirectory | null>;
  fonts: Pick<DesignFontClient, 'list' | 'read'>;
  onCreate(scope: DesignScope, draft: NewDesignDraft): Promise<void>;
  onImportPackage?(file: File, destination: DesignPackageDestination): Promise<void>;
  translate: RendererTranslate;
}>;

export const DesignCreateDocument = forwardRef<DesignCreateDocumentHandle, DesignCreateDocumentProps>(function DesignCreateDocument({
  projects, defaultProjectId, onCreate, onImportPackage, chooseDirectory, fonts, translate: t,
}, ref) {
  const [draft, setDraft] = useState<{ source?: DesignImportSource }>();
  const [directory, setDirectory] = useState<DesignDirectory | null>(null);
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const formId = useId();
  const nameId = useId();
  const locationId = useId();
  const projectIdField = useId();
  const errorId = useId();
  const toast = useToast();
  const newLabel = t('feature.design.newDocument');
  const source = draft?.source;
  const label = source ? t('feature.design.catalog.importDocument') : newLabel;
  const nameLabel = t(source?.kind === 'package' ? 'feature.design.catalog.packageFolderName' : 'feature.design.name');
  const linkedProject = projects.find(({ id }) => id === projectId);
  useImperativeHandle(ref, () => ({ openImport: open }));

  function open(source?: DesignImportSource) {
    if (draft || submitting.current) return;
    if (source?.kind === 'pencil' && source.size > WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES) {
      toast.error(t('feature.design.catalog.importDocumentTooLarge'));
      return;
    }
    setDirectory(null);
    setName(source?.name ?? '');
    setProjectId(defaultProjectId ?? '');
    setError(undefined);
    setDraft({ source });
  }

  function close() {
    if (!submitting.current) setDraft(undefined);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !draft) return;
    if (source?.kind === 'package' ? !isDesignPackageFolderName(name) : !isValidWorkspaceEntryName(name)) {
      setError(t(source?.kind === 'package' ? 'feature.design.catalog.invalidPackageFolderName' : 'feature.design.invalidDocumentName'));
      return;
    }
    const fileName = designDocumentFileName(name);
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      const scope = { storageId: directory?.id ?? 'local' };
      const project = linkedProject ? { linkedProjectId: linkedProject.id } : {};
      if (source?.kind === 'package') {
        if (!onImportPackage) throw new Error(t('feature.design.catalog.packageImportUnavailable'));
        await onImportPackage(source.file, { scope, name, ...project });
      } else {
        const next = { name: fileName, ...project };
        await onCreate(scope, source ? { ...next, initialLayers: await source.read(fonts) } : next);
      }
      setDraft(undefined);
    } catch (cause: unknown) {
      if (cause instanceof FeatureOperationFailure && cause.code === WORKSPACE_ENTRY_EXISTS_ERROR_CODE) {
        setError(t('feature.design.documentExists', { name: fileName }));
      } else if (!isFeatureOperationCancelled(cause)) {
        toast.error(t(source ? 'feature.design.catalog.importDocumentFailed' : 'feature.design.createDocumentFailed', {
          error: cause instanceof Error ? cause.message : String(cause),
        }));
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <>
    <input ref={input} type="file" accept={onImportPackage ? '.zip,.pen' : '.pen'} hidden onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      const source = file && designImportSource(file);
      if (source) open(source);
    }} />
    <Button size="large" icon={<Upload size={16} aria-hidden="true" />} onClick={() => input.current?.click()}>
      {t('feature.design.catalog.import')}
    </Button>
    <Button variant="primary" size="large" icon={<Plus size={16} aria-hidden="true" />}
      aria-haspopup="dialog" onClick={() => open()}>{newLabel}</Button>
    <Dialog open={Boolean(draft)} title={label} width={420} onClose={close} dismissible={!pending} footer={<>
      <Button disabled={pending} onClick={close}>{t('feature.design.cancel')}</Button>
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
});
