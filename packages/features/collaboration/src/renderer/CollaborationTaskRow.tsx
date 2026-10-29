import { Button } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { CollaborationTask } from '../contracts/index.js';
import { AgentAvatar } from './AgentAvatar.js';
import { useCollaborationTaskNavigation } from './context.js';

export function CollaborationTaskRow({ parentThreadId, task, translate }: Readonly<{
  parentThreadId: string;
  task: CollaborationTask;
  translate: RendererTranslate;
}>) {
  const navigation = useCollaborationTaskNavigation();
  return (
    <Button
      variant="ghost"
      className="collaboration-task-row"
      disabled={!navigation}
      title={task.title || translate('feature.collaboration.overview.unnamedTask')}
      onClick={() => navigation?.openTask(parentThreadId, task)}
    >
      <AgentAvatar identity={task.identity} size={18} />
      <span className="collaboration-task-row__text">
        <strong>{task.identity.displayName}</strong>
        {task.title ? <span className="collaboration-task-row__title">{task.title}</span> : null}
      </span>
    </Button>
  );
}
