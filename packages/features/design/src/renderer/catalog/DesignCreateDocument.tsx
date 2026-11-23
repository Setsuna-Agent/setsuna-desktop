import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { isValidWorkspaceEntryName, WORKSPACE_ENTRY_EXISTS_ERROR_CODE } from '@setsuna-desktop/contracts';
import { FeatureOperationFailure, isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Popover, TextField, useToast } from '@setsuna-desktop/renderer-ui';
import { designDocumentFileName, type DesignDirectory, type DesignWorkspace as DesignScope } from '../../contracts/index.js';
import { DesignLocationField } from './DesignLocationField.js';

export function DesignCreateDocument({ children, onCreate, chooseDirectory, translate: t }: Readonly<{
  children: ReactElement;
  chooseDirectory(): Promise<DesignDirectory | null>;
  onCreate(scope: DesignScope, name: string): Promise<void>;
  translate: RendererTranslate;
}>) {
  const [open, setOpen] = useState(false);
  const [directory, setDirectory] = useState<DesignDirectory | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const errorId = useId();
  const toast = useToast();
  const label = t('feature.design.newDocument');
  const nameLabel = t('feature.design.name');

  function changeOpen(next: boolean) {
    if (submitting.current) return;
    if (next) { setDirectory(null); setName(''); setError(undefined); }
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
      await onCreate({ storageId: directory?.id ?? 'local' }, fileName);
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

  return <Popover open={open} onOpenChange={changeOpen} placement="bottomRight" className="design-form-popover" contentLabel={label}
    content={open ? <form className="design-popover-form" onSubmit={(event) => { void submit(event); }}>
      <TextField autoFocus aria-label={nameLabel} placeholder={nameLabel} value={name} disabled={pending}
        aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
        onChange={(event) => { setName(event.currentTarget.value); setError(undefined); }}
        onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
      {error ? <span className="design-popover-form__error" id={errorId} role="alert">{error}</span> : null}
      <div className="design-location-footer">
        <DesignLocationField directory={directory} choose={chooseDirectory} onChange={setDirectory} disabled={pending} translate={t} />
        <Button size="small" variant="ghost" disabled={pending} onClick={() => changeOpen(false)}>{t('feature.design.cancel')}</Button>
        <Button size="small" type="submit" variant="primary" loading={pending} disabled={!name}>{label}</Button>
      </div>
    </form> : null}>{children}</Popover>;
}
