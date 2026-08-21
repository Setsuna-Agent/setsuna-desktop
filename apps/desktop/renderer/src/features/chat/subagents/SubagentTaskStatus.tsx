import type { RuntimeCollaborationTaskStatus } from '@setsuna-desktop/contracts';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';

const STATUS_I18N_KEYS = {
  queued: 'subagent.status.queued',
  running: 'subagent.status.running',
  waiting_approval: 'subagent.status.waitingApproval',
  completed: 'subagent.status.completed',
  failed: 'subagent.status.failed',
  cancelled: 'subagent.status.cancelled',
  interrupted: 'subagent.status.interrupted',
} as const satisfies Record<RuntimeCollaborationTaskStatus, string>;

export function collaborationTaskStatusLabel(
  status: RuntimeCollaborationTaskStatus,
  t: Translate,
): string {
  return t(STATUS_I18N_KEYS[status] ?? STATUS_I18N_KEYS.running);
}

export function SubagentTaskStatus({
  status,
  className = '',
  showLabel = true,
}: {
  status: RuntimeCollaborationTaskStatus;
  className?: string;
  showLabel?: boolean;
}) {
  const { t } = useI18n();
  const label = collaborationTaskStatusLabel(status, t);
  return (
    <span
      className={`subagent-task-status subagent-task-status--${status} ${className}`.trim()}
      aria-label={showLabel ? undefined : label}
      role={showLabel ? undefined : 'img'}
      title={showLabel ? undefined : label}
    >
      <span className="subagent-task-status__dot" aria-hidden="true" />
      {showLabel ? <span>{label}</span> : null}
    </span>
  );
}
