import { Button } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { isTerminalCollaborationTaskStatus, type CollaborationTask } from '../contracts/index.js';
import { AgentAvatar } from './AgentAvatar.js';
import { collaborationTaskTime } from './collaborationTaskTime.js';
import { useCollaborationTaskNavigation } from './context.js';
import { SubagentTaskStatus } from './SubagentTaskStatus.js';

export function CollaborationTaskRow({ parentThreadId, task, translate, startedAt, nowMs }: Readonly<{
  parentThreadId: string;
  task: CollaborationTask;
  translate: RendererTranslate;
  startedAt: string;
  nowMs: number;
}>) {
  const navigation = useCollaborationTaskNavigation();
  const time = collaborationTaskTime(task, startedAt, nowMs, translate);
  return (
    <Button
      variant="ghost"
      className="collaboration-task-row"
      disabled={!navigation}
      title={task.title || translate('feature.collaboration.overview.unnamedTask')}
      onClick={() => navigation?.openTask(parentThreadId, task)}
    >
      <span className="collaboration-task-row__avatar">
        <AgentAvatar identity={task.identity} size={20} />
      </span>
      <span className="collaboration-task-row__text">
        <span className="collaboration-task-row__name">{task.identity.displayName}</span>
        {!isTerminalCollaborationTaskStatus(task.status) ? (
          <SubagentTaskStatus className="collaboration-task-row__status" status={task.status} translate={translate} />
        ) : null}
      </span>
      {time ? <time className="collaboration-task-row__time" dateTime={time.at}>{time.label}</time> : null}
    </Button>
  );
}
