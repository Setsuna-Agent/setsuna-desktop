import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { Clock3 } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function SidebarThreadAutomationBadge({ thread }: { thread: Pick<RuntimeThreadSummary, 'origin'> }) {
  const { t } = useI18n();
  if (thread.origin?.featureId !== 'automation') return null;
  const label = t('feature.automation.title');
  return (
    <span className="desktop-agent-thread-origin-badge" role="img" aria-label={label} title={label}>
      <Clock3 size={12} strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
}
