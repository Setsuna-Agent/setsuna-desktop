import { Gauge } from 'lucide-react';
import type { RefObject } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';

export function RuntimeActivityTrigger({
  open,
  runningTaskCount,
  triggerRef,
  onToggle,
}: {
  open: boolean;
  runningTaskCount: number;
  triggerRef: RefObject<HTMLButtonElement>;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const label = runningTaskCount
    ? t('topbar.openRuntimeActivityCount', { count: runningTaskCount })
    : t('topbar.openRuntimeActivity');

  return (
    <IconButton
      ref={triggerRef}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={`app-shell-icon-control app-topbar-runtime-activity ${open ? 'is-active' : ''}`}
      label={label}
      onClick={onToggle}
    >
      <Gauge size={16} />
    </IconButton>
  );
}
