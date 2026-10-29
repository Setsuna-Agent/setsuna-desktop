import { IconButton } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { X } from 'lucide-react';
import type { CollaborationTaskStatus } from '../contracts/index.js';
import { CollaborationTaskRow } from './CollaborationTaskRow.js';
import { useCollaborationState } from './context.js';
import { collaborationTaskStatusLabel } from './SubagentTaskStatus.js';

// Keep actionable and ongoing work above finished tasks; preserve task order within each group.
const TASK_GROUP_ORDER: readonly CollaborationTaskStatus[] = [
  'waiting_approval', 'running', 'queued', 'failed', 'interrupted', 'cancelled', 'completed',
];

export function CollaborationTaskDirectory({ parentThreadId, translate, onClose }: Readonly<{
  parentThreadId: string;
  translate: RendererTranslate;
  onClose: () => void;
}>) {
  const { state } = useCollaborationState(parentThreadId);
  const groups = TASK_GROUP_ORDER.map((status) => ({
    status,
    tasks: state.tasks.filter((task) => task.status === status),
  })).filter((group) => group.tasks.length > 0);
  return (
    <>
      <header className="subagent-panel-header">
        <strong className="subagent-panel-header__name">{translate('feature.collaboration.overview.tasks')}</strong>
        <IconButton className="subagent-panel-header__close" label={translate('feature.collaboration.panel.close')} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </header>
      <div className="collaboration-task-directory__list">
        {groups.map((group) => (
          <section className="collaboration-task-directory__group" key={group.status}>
            <h3 className="collaboration-task-directory__group-title">{collaborationTaskStatusLabel(group.status, translate)}</h3>
            {group.tasks.map((task) => (
              <CollaborationTaskRow key={task.id} parentThreadId={parentThreadId} task={task} translate={translate} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
