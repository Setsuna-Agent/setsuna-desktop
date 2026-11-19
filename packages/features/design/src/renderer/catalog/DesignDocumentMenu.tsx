import { Ellipsis, FolderInput, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown, IconButton, Popover } from '@setsuna-desktop/renderer-ui';

export function DesignDocumentMenu({ name, disabled, form, onCloseForm, onMove, onDelete, translate: t }: Readonly<{
  name: string;
  disabled: boolean;
  form?: Readonly<{ label: string; content: ReactNode }>;
  onCloseForm(): void;
  onMove?(): void;
  onDelete(): void;
  translate: RendererTranslate;
}>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const openingForm = useRef(false);
  function showDeleteForm() {
    openingForm.current = true;
    setMenuOpen(false);
    onDelete();
  }
  return <Popover open={Boolean(form)} onOpenChange={(next) => { if (!next && form && !disabled) onCloseForm(); }}
    placement="bottomRight" className="design-form-popover" contentLabel={form?.label} content={form?.content}>
    <Dropdown open={menuOpen} onOpenChange={setMenuOpen} placement="bottomRight" disabled={disabled || Boolean(form)}
      onCloseAutoFocus={(event) => {
        // The opened form receives focus as the menu closes.
        if (form || openingForm.current) event.preventDefault();
        openingForm.current = false;
      }} menu={{ items: [
        onMove ? { key: 'move', label: t('feature.design.moveDocument'), icon: <FolderInput size={14} />, onClick: onMove } : null,
        { key: 'delete', label: t('feature.design.deleteDocument'), icon: <Trash2 size={14} />, danger: true, onClick: showDeleteForm },
      ] }}>
      <IconButton size="small" disabled={disabled} label={t('feature.design.documentActions', { name })}
        aria-expanded={menuOpen || Boolean(form)} aria-haspopup={form ? 'dialog' : 'menu'}><Ellipsis size={16} /></IconButton>
    </Dropdown>
  </Popover>;
}
