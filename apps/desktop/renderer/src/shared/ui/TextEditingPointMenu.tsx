import type { DesktopTextEditCommand } from '@setsuna-desktop/contracts';
import { PointMenu, type MenuItem, type MenuProps } from '@setsuna-desktop/renderer-ui';
import { ClipboardPaste, Copy, Scissors } from 'lucide-react';
import { useRef } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';
import type { TextContextMenuTarget } from '../lib/textContextMenu.js';

/** Text commands can augment a surface's menu while sharing native selection restoration. */
export function TextEditingPointMenu({ x, y, textTarget, menu, onClose, isCurrent }: {
  x: number;
  y: number;
  textTarget?: TextContextMenuTarget | null;
  menu?: MenuProps;
  onClose(): void;
  isCurrent?(): boolean;
}) {
  const { t } = useI18n();
  const pending = useRef<DesktopTextEditCommand>();
  const restoreOnDismiss = useRef(true);
  const choose = (command: DesktopTextEditCommand) => { pending.current = command; };
  const textItems: MenuItem[] = textTarget ? [
    { key: 'text-cut', label: t('shell.menu.cut'), icon: <Scissors size={14} />,
      disabled: !textTarget.editable || !textTarget.canCopy, onClick: () => choose('cut') },
    { key: 'text-copy', label: t('shell.menu.copy'), icon: <Copy size={14} />,
      disabled: !textTarget.canCopy, onClick: () => choose('copy') },
    { key: 'text-paste', label: t('shell.menu.paste'), icon: <ClipboardPaste size={14} />,
      disabled: !textTarget.editable, onClick: () => choose('paste') },
  ] : [];
  return <PointMenu x={x} y={y} modal={Boolean(textTarget)} onClose={onClose}
    onCloseAutoFocus={(event) => {
      if (!textTarget) return;
      event.preventDefault();
      if (!restoreOnDismiss.current) return;
      // Radix must release focus before Electron edits the original selection/caret.
      const command = pending.current;
      pending.current = undefined;
      if (isCurrent?.() === false || !textTarget.restore(command) || !command) return;
      void window.setsunaDesktop?.windowControls.executeTextEdit(command).catch((error: unknown) => {
        console.error('[TextEditingPointMenu] text editing failed', error);
      });
    }}
    menu={{ ...menu, items: [
      ...textItems,
      ...(textItems.length && menu?.items?.length ? [{ type: 'divider' as const }] : []),
      ...(menu?.items ?? []),
    ], onClick: (action) => {
      // File actions may open a dialog or another tab; never steal their new focus.
      restoreOnDismiss.current = Boolean(pending.current);
      menu?.onClick?.(action);
      onClose();
    } }} />;
}
