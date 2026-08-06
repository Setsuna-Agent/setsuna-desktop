import { Gauge } from 'lucide-react';
import type { RefObject } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';

export function RuntimeActivityTrigger({
  open,
  triggerRef,
  onToggle,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement>;
  onToggle: () => void;
}) {
  const { t } = useI18n();

  return (
    <IconButton
      ref={triggerRef}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={`app-shell-icon-control app-topbar-runtime-activity ${open ? 'is-active' : ''}`}
      label={t('topbar.openRuntimeActivity')}
      onClick={onToggle}
    >
      <Gauge size={16} />
    </IconButton>
  );
}
