import { Ellipsis, FolderInput, Link2, Trash2, Unlink2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown, IconButton, Popover, type MenuItem } from '@setsuna-desktop/renderer-ui';
import { DesignProjectIcon } from './DesignProjectIcon.js';
import type { DesignProject } from './DesignScopeFields.js';

export function DesignDocumentMenu({ name, disabled, form, projectId, projects, onChangeProject, onCloseForm, onMove, onDelete, translate: t }: Readonly<{
  name: string;
  disabled: boolean;
  form?: Readonly<{ label: string; content: ReactNode }>;
  projectId: string | null;
  projects: readonly DesignProject[];
  onChangeProject(projectId: string | null): void;
  onCloseForm(): void;
  onMove?(): void;
  onDelete(): void;
  translate: RendererTranslate;
}>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const openingConfirmation = useRef(false);
  const noProjectKey = 'project:none';
  const projectOptionKey = (id: string) => `linked-project:${id}`;
  const projectMenu: MenuItem | null = menuOpen && (projects.length > 0 || projectId !== null) ? {
    key: 'project', label: t('feature.design.linkProject'), icon: <Link2 size={14} />,
    children: [
      { key: noProjectKey, label: t('feature.design.noLinkedProject'), icon: <Unlink2 size={14} />,
        onClick: () => { if (projectId !== null) onChangeProject(null); } },
      projects.length > 0 ? { key: 'project-divider', type: 'divider' } : null,
      ...projects.map(({ id, name, icon }) => ({ key: projectOptionKey(id), label: name, icon: <DesignProjectIcon icon={icon} />,
        onClick: () => { if (projectId !== id) onChangeProject(id); } })),
    ],
  } : null;

  function requestDelete() {
    openingConfirmation.current = true;
    setMenuOpen(false);
    // Let the dialog restore focus to the card action if the user cancels.
    trigger.current?.focus({ preventScroll: true });
    onDelete();
  }
  return <Popover open={Boolean(form)} onOpenChange={(next) => { if (!next && form && !disabled) onCloseForm(); }}
    placement="bottomRight" className="design-form-popover design-location-popover" contentLabel={form?.label} content={form?.content}>
    <Dropdown open={menuOpen} onOpenChange={setMenuOpen} placement="bottomRight" align={{ offset: [8, -4] }}
      disabled={disabled || Boolean(form)}
      onCloseAutoFocus={(event) => {
        // Leave focus with the confirmation dialog or move form.
        if (form || openingConfirmation.current) event.preventDefault();
        openingConfirmation.current = false;
      }} menu={{ selectedKeys: projectId === null ? [noProjectKey] : [projectOptionKey(projectId)], items: [
        projectMenu,
        onMove ? { key: 'move', label: t('feature.design.moveDocument'), icon: <FolderInput size={14} />, onClick: onMove } : null,
        { key: 'delete', label: t('feature.design.deleteDocument'), icon: <Trash2 size={14} />, danger: true, onClick: requestDelete },
      ] }}>
      <IconButton ref={trigger} size="small" label={t('feature.design.documentActions', { name })} disabled={disabled}
        aria-expanded={menuOpen || Boolean(form)} aria-haspopup={form ? 'dialog' : 'menu'}>
        <Ellipsis size={16} />
      </IconButton>
    </Dropdown>
  </Popover>;
}
