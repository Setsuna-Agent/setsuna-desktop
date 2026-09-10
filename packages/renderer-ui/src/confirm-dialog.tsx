import { TriangleAlert } from 'lucide-react';
import { Slot } from 'radix-ui';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from './button.js';
import { Dialog } from './dialog.js';
import { useUiLabels } from './locale.js';

export type ConfirmationOptions = {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  danger?: boolean;
  /** Informational dialogs only need a close action. */
  acknowledgement?: boolean;
};

export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, danger, acknowledgement,
  pending = false, error, onConfirm, onClose }: ConfirmationOptions & {
  open: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm(): void;
  onClose(): void;
}) {
  const labels = useUiLabels();
  return <Dialog open={open} width={420} dismissible={!pending} onClose={onClose}
    title={<span className="sd-confirm-dialog__title">
      {!acknowledgement ? <TriangleAlert size={16} aria-hidden="true" /> : null}{title}
    </span>}
    footer={<>
      {!acknowledgement ? <Button disabled={pending} onClick={onClose}>{cancelLabel ?? labels.cancel}</Button> : null}
      <Button variant={acknowledgement ? 'secondary' : danger ? 'danger' : 'primary'} loading={pending} onClick={onConfirm}>
        {confirmLabel ?? (acknowledgement ? labels.close : labels.confirm)}
      </Button>
    </>}>
    {description ? <div className="sd-confirm-dialog__description">{description}</div> : null}
    {error ? <p role="alert" className="sd-control-error">{error}</p> : null}
  </Dialog>;
}

export function ConfirmDialogTrigger({ children, disabled, onConfirm, ...options }: ConfirmationOptions & {
  children: ReactElement;
  disabled?: boolean;
  onConfirm(): unknown | Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const confirm = async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try { await onConfirm(); setOpen(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { running.current = false; setPending(false); }
  };
  return <>
    <Slot.Root aria-haspopup="dialog" onClick={(event) => {
      if (event.defaultPrevented || disabled || running.current) return;
      setError(null);
      setOpen(true);
    }}>{children}</Slot.Root>
    <ConfirmDialog {...options} open={open} pending={pending} error={error}
      onClose={() => setOpen(false)} onConfirm={() => void confirm()} />
  </>;
}
