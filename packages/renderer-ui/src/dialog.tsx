// beUI's center-modal surface, with Radix owning focus and dismissal.
import { Dialog as Primitive } from 'radix-ui';
import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { overlayContainer } from './portal.js';
import { IconButton } from './button.js';
import { useUiLabels } from './locale.js';
import { cn } from './utils.js';

export type DialogProps = {
  open?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  width?: number;
  closeLabel?: string;
  dismissible?: boolean;
  showClose?: boolean;
  onClose(): void;
  'aria-label'?: string;
};
export function Dialog({ open = true, title, description, children, footer, className, width = 640, closeLabel, dismissible = true, showClose = true, onClose, 'aria-label': label }: DialogProps) {
  const labels = useUiLabels();
  const closeText = closeLabel ?? labels.close;
  const contentRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // Capture before child autoFocus runs; closed dialogs can stay mounted between uses.
  if (open && !wasOpen.current && typeof document !== 'undefined') previousFocus.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;
  return <Primitive.Root open={open} onOpenChange={(next) => { if (!next && dismissible) onClose(); }}>
    <Primitive.Portal container={overlayContainer()}>
      <Primitive.Overlay className="sd-dialog-overlay" />
      <Primitive.Content asChild aria-label={label} {...(!description ? { 'aria-describedby': undefined } : {})}
        onOpenAutoFocus={(event) => {
          // Explicit field autoFocus is already respected by Radix; otherwise focus the surface.
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => { event.preventDefault(); previousFocus.current?.focus({ preventScroll: true }); }}
        onEscapeKeyDown={(event) => { if (!dismissible) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (!dismissible) event.preventDefault(); }}>
        <section ref={contentRef} className={cn('sd-dialog', className)} style={{ width }}>
          <header className={cn('sd-dialog__header', !title && 'sd-visually-hidden')}>
            <Primitive.Title asChild><div className="sd-dialog__title">{title ?? label ?? closeText}</div></Primitive.Title>
            {description ? <Primitive.Description asChild><div className="sd-dialog__description">{description}</div></Primitive.Description> : null}
          </header>
          {showClose ? <Primitive.Close asChild><IconButton className="sd-dialog__close" label={closeText} disabled={!dismissible}><X size={16} /></IconButton></Primitive.Close> : null}
          <div className="sd-dialog__body">{children}</div>
          {footer ? <footer className="sd-dialog__footer">{footer}</footer> : null}
        </section>
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>;
}
