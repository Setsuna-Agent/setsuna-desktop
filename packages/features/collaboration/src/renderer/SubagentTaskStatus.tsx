import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { CollaborationTaskStatus } from '../contracts/index.js';

const STATUS_I18N_KEYS = {
  queued: 'feature.collaboration.status.queued',
  running: 'feature.collaboration.status.running',
  waiting_approval: 'feature.collaboration.status.waitingApproval',
  completed: 'feature.collaboration.status.completed',
  failed: 'feature.collaboration.status.failed',
  cancelled: 'feature.collaboration.status.cancelled',
  interrupted: 'feature.collaboration.status.interrupted',
} as const satisfies Record<CollaborationTaskStatus, `feature.${string}`>;

export function collaborationTaskStatusLabel(
  status: CollaborationTaskStatus,
  translate: RendererTranslate,
): string {
  return translate(STATUS_I18N_KEYS[status]);
}

export function SubagentTaskStatus({
  status,
  translate,
  className = '',
}: Readonly<{
  status: CollaborationTaskStatus;
  translate: RendererTranslate;
  className?: string;
}>) {
  const label = collaborationTaskStatusLabel(status, translate);
  return (
    <span className={`subagent-task-status ${className}`.trim()}>
      {label}
    </span>
  );
}
