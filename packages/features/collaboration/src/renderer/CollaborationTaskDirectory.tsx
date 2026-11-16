import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useMemo } from 'react';
import { isTerminalCollaborationTaskStatus } from '../contracts/index.js';
import { CollaborationTaskRow } from './CollaborationTaskRow.js';
import { useCollaborationState } from './context.js';
import { collaborationTaskStatusLabel } from './SubagentTaskStatus.js';
import { useCollaborationTaskClock } from './useCollaborationTaskClock.js';

// Active tasks share a section and expose their individual status on the second line.
const TASK_GROUP_ORDER = ['active', 'failed', 'interrupted', 'cancelled', 'completed'] as const;

export function CollaborationTaskDirectory({ parentThreadId, translate, active = true }: Readonly<{
  parentThreadId: string;
  translate: RendererTranslate;
  active?: boolean;
}>) {
  const { state } = useCollaborationState(parentThreadId);
  const groups = useMemo(() => TASK_GROUP_ORDER.map((status) => ({
    status,
    tasks: state.tasks.filter((task) => status === 'active'
      ? !isTerminalCollaborationTaskStatus(task.status) : task.status === status),
  })).filter((group) => group.status === 'active' || group.tasks.length > 0), [state.tasks]);
  const executions = useMemo(() => new Map(state.executions.map((execution) => [execution.turnId, execution])), [state.executions]);
  const hasActiveTasks = groups.some((group) => group.status === 'active' && group.tasks.length > 0);
  const nowMs = useCollaborationTaskClock(active && state.tasks.length > 0, hasActiveTasks);
  return (
    <div className="collaboration-task-directory__list">
      {groups.map((group) => (
        <section className="collaboration-task-directory__group" key={group.status}>
          <h3 className="collaboration-task-directory__group-title">
            {group.status === 'active' ? translate('feature.collaboration.directory.active') : collaborationTaskStatusLabel(group.status, translate)}
            {' · '}{group.tasks.length}
          </h3>
          {group.tasks.length > 0 ? (
            <div className="collaboration-task-directory__rows">
              {group.tasks.map((task) => (
                <CollaborationTaskRow
                  key={task.id} parentThreadId={parentThreadId} task={task} translate={translate}
                  startedAt={executions.get(task.activeTurnId ?? '')?.createdAt ?? task.createdAt} nowMs={nowMs}
                />
              ))}
            </div>
          ) : (
            <p className="collaboration-task-directory__empty">{translate('feature.collaboration.directory.emptyActive')}</p>
          )}
        </section>
      ))}
    </div>
  );
}
