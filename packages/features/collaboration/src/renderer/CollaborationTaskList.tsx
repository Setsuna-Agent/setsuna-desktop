import { Button } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Users } from 'lucide-react';
import type { CollaborationTask } from '../contracts/index.js';
import { AgentAvatar } from './AgentAvatar.js';
import { useCollaborationTaskNavigation } from './context.js';

const OVERVIEW_AVATAR_LIMIT = 5;

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
      <Button
        variant="ghost"
        className="chat-conversation-overview-panel__row"
        disabled={!navigation}
        aria-label={translate('feature.collaboration.overview.openList')}
        title={translate('feature.collaboration.overview.openList')}
        onClick={() => navigation?.openList(parentThreadId)}
      >
        <span className="chat-conversation-overview-panel__icon">
          <Users size={14} aria-hidden="true" />
        </span>
        <span className="chat-conversation-overview-panel__label">{translate('feature.collaboration.overview.tasks')}</span>
        <span className="chat-conversation-overview-panel__meta collaboration-overview__avatars">
          {tasks.slice(0, OVERVIEW_AVATAR_LIMIT).map((task) => (
            <span className="collaboration-overview__avatar" key={task.id}>
              <AgentAvatar identity={task.identity} size={14} />
            </span>
          ))}
          {tasks.length > OVERVIEW_AVATAR_LIMIT ? (
            <span className="collaboration-overview__remaining" aria-hidden="true">+{tasks.length - OVERVIEW_AVATAR_LIMIT}</span>
          ) : null}
        </span>
      </Button>
    </div>
  );
}
