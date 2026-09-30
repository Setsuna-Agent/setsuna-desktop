import { MessageSquare, Plus, SquarePen } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown, IconButton } from '@setsuna-desktop/renderer-ui';

export function AutomationCreateMenu({ busy, translate: t, onCreateChat, onCreateForm }: {
  busy: boolean;
  translate: RendererTranslate;
  onCreateChat(): void;
  onCreateForm(): void;
}) {
  return <Dropdown disabled={busy} placement="bottomRight" menu={{ items: [
    {
      key: 'chat', label: t('feature.automation.createChat'), icon: <MessageSquare size={16} />,
      disabled: busy, onClick: onCreateChat,
    },
    {
      key: 'form', label: t('feature.automation.createForm'), icon: <SquarePen size={16} />,
      disabled: busy, onClick: onCreateForm,
    },
  ] }}>
    <IconButton label={t('feature.automation.create')} disabled={busy}><Plus size={16} aria-hidden="true" /></IconButton>
  </Dropdown>;
}
