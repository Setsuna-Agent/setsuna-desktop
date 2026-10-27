import type { DesktopTextEditCommand } from '@setsuna-desktop/contracts';
import { PointMenu } from '@setsuna-desktop/renderer-ui';
import { ClipboardPaste, Copy, Scissors } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { captureTextContextMenuTarget, type TextContextMenuTarget } from '../../shared/lib/textContextMenu.js';

type TextMenuRequest = { id: number; x: number; y: number; target: TextContextMenuTarget };

export function AppTextContextMenu() {
  const [request, setRequest] = useState<TextMenuRequest | null>(null);
  const current = useRef<TextMenuRequest | null>(null);
  const sequence = useRef(0);
  const close = useCallback(() => setRequest(null), []);
  useEffect(() => {
    const open = (event: MouseEvent) => {
      // Specialized link, file, image and terminal menus handle the event first.
      if (event.defaultPrevented || !window.setsunaDesktop?.windowControls.executeTextEdit) return;
      const target = captureTextContextMenuTarget(event);
      if (!target) return;
      event.preventDefault();
      const next = { id: ++sequence.current, x: event.clientX, y: event.clientY, target };
      current.current = next;
      setRequest(next);
    };
    window.addEventListener('contextmenu', open);
    return () => { window.removeEventListener('contextmenu', open); current.current = null; };
  }, []);

  return request ? <TextEditingMenu key={request.id} request={request} onClose={close}
    isCurrent={() => current.current === request} /> : null;
}

function TextEditingMenu({ request, onClose, isCurrent }: {
  request: TextMenuRequest;
  onClose(): void;
  isCurrent(): boolean;
}) {
  const { t } = useI18n();
  const pending = useRef<DesktopTextEditCommand>();
  const { target } = request;
  const choose = (command: DesktopTextEditCommand) => { pending.current = command; onClose(); };
  return <PointMenu x={request.x} y={request.y} modal onClose={onClose}
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      // Wait for Radix to release focus so native editing targets the original text.
      const command = pending.current;
      pending.current = undefined;
      if (!isCurrent() || !target.restore(command) || !command) return;
      void window.setsunaDesktop?.windowControls.executeTextEdit(command).catch((error: unknown) => {
        console.error('[AppTextContextMenu] text editing failed', error);
      });
    }}
    menu={{ items: [
      ...(target.editable ? [{ key: 'cut', label: t('shell.menu.cut'), icon: <Scissors size={14} />,
        disabled: !target.canCopy, onClick: () => choose('cut') }] : []),
      { key: 'copy', label: t('shell.menu.copy'), icon: <Copy size={14} />,
        disabled: !target.canCopy, onClick: () => choose('copy') },
      ...(target.editable ? [{ key: 'paste', label: t('shell.menu.paste'), icon: <ClipboardPaste size={14} />,
        onClick: () => choose('paste') }] : []),
    ] }} />;
}
