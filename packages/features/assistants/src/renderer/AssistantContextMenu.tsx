import type { ReactElement } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown } from '@setsuna-desktop/renderer-ui';
import { Settings, Trash2 } from 'lucide-react';

/** Configuration actions for the home's assistant entry. */
export function AssistantContextMenu({ children, disabled, onEdit, onDelete, translate: t }: {
  children: ReactElement;
  disabled?: boolean;
  onEdit(): void;
  onDelete(): void;
  translate: RendererTranslate;
}) {
  return <Dropdown trigger={['contextMenu']} disabled={disabled} menu={{ items: [
    { key: 'edit', label: t('feature.assistants.edit'), icon: <Settings size={14} />, disabled,
      onClick: () => { if (!disabled) onEdit(); } },
    { type: 'divider' },
    { key: 'delete', label: t('feature.assistants.delete'), icon: <Trash2 size={14} />, danger: true, disabled,
      onClick: () => { if (!disabled) onDelete(); } },
  ] }}>
    {children}
  </Dropdown>;
}
