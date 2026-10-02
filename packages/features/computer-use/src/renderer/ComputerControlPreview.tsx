import { Button, Popover } from '@setsuna-desktop/renderer-ui';
import type { ShellTopbarActionSlotProps } from '@setsuna-desktop/renderer-contracts/shell';
import { Monitor, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComputerBridge } from '../contracts/index.js';
import { useComputerControl } from './useComputerControl.js';
import './computer-preview.css';

export function ComputerControlPreview({ bridge, ui, translate: t }: {
  bridge: ComputerBridge;
} & Pick<ShellTopbarActionSlotProps, 'ui' | 'translate'>) {
  const [open, setOpen] = useState(false);
  const control = useComputerControl(bridge, open);
  const pinned = useRef(false);
  const restoreFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const clearHover = () => { clearTimeout(timer.current); };

  useEffect(() => {
    if (!control.active) { setOpen(false); pinned.current = false; }
    return () => { clearTimeout(timer.current); };
  }, [control.active]);

  const enter = () => {
    clearHover();
    if (!open) timer.current = setTimeout(() => setOpen(true), 150);
  };
  const leave = () => {
    clearHover();
    if (!pinned.current) timer.current = setTimeout(() => setOpen(false), 200);
  };
  const changeOpen = (next: boolean) => {
    clearHover();
    pinned.current = next;
    setOpen(next);
  };
  if (!control.active) return null;

  return (
    <Popover open={open} onOpenChange={changeOpen} placement="bottomRight"
      className="computer-preview"
      onPointerEnter={enter} onPointerLeave={leave}
      // Hover must not take focus from the user's work; click/keyboard retain normal popover focus.
      onOpenAutoFocus={(event) => { restoreFocus.current = pinned.current; if (!pinned.current) event.preventDefault(); }}
      onCloseAutoFocus={(event) => { if (!restoreFocus.current) event.preventDefault(); }}
      content={(
        <div onPointerEnter={enter} onPointerLeave={leave}
          onFocusCapture={() => { clearHover(); pinned.current = true; }}>
          <div className="computer-preview__screen" aria-busy={!control.frame && !control.error}>
            {control.frame ? (
              <img src={control.frame.dataUrl} width={control.frame.width} height={control.frame.height}
                alt={t('feature.computerUse.preview')} draggable={false} />
            ) : control.error ? <Monitor size={28} aria-hidden="true" /> : (
              <span className="sd-spinner" role="status" aria-label={t('feature.computerUse.preview.loading')} />
            )}
          </div>
          <div className="computer-preview__actions">
            {control.error ? <div className="computer-preview__error" role="alert">{control.error}</div> : null}
            <Button variant="danger" size="small" loading={control.stopping}
              icon={<Square size={12} fill="currentColor" aria-hidden="true" />}
              title="Ctrl / ⌘ + Shift + Esc" onClick={() => { void control.stop(); }}>
              {t('feature.computerUse.stop')}
            </Button>
          </div>
        </div>
      )}>
      <ui.IconButton label={t('feature.computerUse.preview')} title="" aria-expanded={open}>
        <Monitor size={18} aria-hidden="true" />
      </ui.IconButton>
    </Popover>
  );
}
