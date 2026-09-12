import { isValidWorkspaceEntryName, type WorkspaceEntry } from '@setsuna-desktop/contracts';
import { Button, Dialog, TextField } from '@setsuna-desktop/renderer-ui';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export type WorkspaceEntryDialogRequest =
  | { mode: 'create'; parentPath: string; type: WorkspaceEntry['type'] }
  | { mode: 'rename'; entry: Pick<WorkspaceEntry, 'name' | 'path' | 'type'> };

export function WorkspaceEntryDialog({ request, onClose, onSubmit }: {
  request: WorkspaceEntryDialogRequest;
  onClose(): void;
  onSubmit(name: string): Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(request.mode === 'rename' ? request.entry.name : '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submitting = useRef(false);
  const formId = useId();
  const errorId = useId();
  const title = t(request.mode === 'rename' ? 'workspace.fileMenu.rename'
    : request.type === 'directory' ? 'workspace.fileMenu.newFolder' : 'workspace.fileMenu.newFile');

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    if (!isValidWorkspaceEntryName(name)) {
      setError(t('workspace.files.invalidEntryName'));
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await onSubmit(name);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog title={title} width={400} onClose={onClose} dismissible={!pending}
      description={request.mode === 'rename' ? request.entry.path : request.parentPath || t('workspace.files.workspaceRoot')}
      footer={<>
        <Button disabled={pending} onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form={formId} loading={pending} disabled={!name}>{t('common.confirm')}</Button>
      </>}
    >
      <form id={formId} className="desktop-entry-form" onSubmit={(event) => { void submit(event); }}>
        <TextField ref={inputRef} aria-label={t('workspace.files.entryName')} value={name} disabled={pending}
          aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
          onChange={(event) => { setName(event.target.value); setError(null); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
          }}
        />
        {error ? <p id={errorId} className="desktop-entry-form__error" role="alert">{error}</p> : null}
      </form>
    </Dialog>
  );
}
