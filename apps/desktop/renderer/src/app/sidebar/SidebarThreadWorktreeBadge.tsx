import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { Split } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function SidebarThreadWorktreeBadge({ thread }: { thread: Pick<RuntimeThreadSummary, 'workspaceId'> }) {
  const { t } = useI18n();
  if (!thread.workspaceId) return null;
  return (
    <span className="desktop-agent-thread-worktree-badge" role="img" aria-label={t('sidebar.worktreeChat')} title={t('sidebar.worktreeChat')}>
      <Split size={12} strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
}
