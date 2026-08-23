import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { CollaborationTask } from '../contracts/index.js';
import { AgentAvatar } from './AgentAvatar.js';
import { useCollaborationTaskNavigation } from './context.js';
import { SubagentTaskStatus } from './SubagentTaskStatus.js';

export function CollaborationTaskList({
  parentThreadId,
  tasks,
  translate,
}: Readonly<{
  parentThreadId: string;
  tasks: readonly CollaborationTask[];
  translate: RendererTranslate;
}>) {
  const navigation = useCollaborationTaskNavigation();
  if (!tasks.length) return null;
  return (
    <div className="collaboration-overview">
      <div className="collaboration-overview__divider" />
      <div className="collaboration-overview__tasks">
        <div className="collaboration-overview__title">
          <span>{translate('feature.collaboration.overview.tasks')}</span>
          <span aria-label={translate(
            tasks.length === 1
              ? 'feature.collaboration.overview.count.one'
              : 'feature.collaboration.overview.count.many',
            { count: tasks.length },
          )}>{tasks.length}</span>
        </div>
        {tasks.map((task) => (
          <button
            type="button"
            className="collaboration-overview__task"
            key={task.id}
            disabled={!navigation}
            title={task.title || translate('feature.collaboration.overview.unnamedTask')}
            onClick={() => navigation?.(parentThreadId, task)}
          >
            <AgentAvatar identity={task.identity} size={20} />
            <strong>{task.identity.displayName}</strong>
            <SubagentTaskStatus status={task.status} translate={translate} />
          </button>
        ))}
      </div>
    </div>
  );
}
