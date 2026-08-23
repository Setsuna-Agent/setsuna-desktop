import type { ToolResultViewProps } from '@setsuna-desktop/feature-core/renderer';
import type { CollaborationSpawnResult } from '../contracts/index.js';
import { AgentAvatar } from './AgentAvatar.js';
import { useCollaborationState, useCollaborationTaskNavigation } from './context.js';
import { SubagentTaskStatus } from './SubagentTaskStatus.js';

export function CollaborationSpawnResultView({
  payload,
  threadId,
  translate,
}: ToolResultViewProps<CollaborationSpawnResult>) {
  const liveParentThreadId = threadId === payload.parentThreadId ? threadId : null;
  const snapshot = useCollaborationState(liveParentThreadId);
  const task = liveParentThreadId
    ? snapshot.state.tasks.find((candidate) => (
        candidate.id === payload.taskId || candidate.childThreadId === payload.childThreadId
      ))
    : undefined;
  const navigation = useCollaborationTaskNavigation();
  const identity = task?.identity ?? payload.identity;
  const status = task?.status ?? payload.status;
  const historical = !liveParentThreadId || (!snapshot.loading && !task);
  const canOpen = Boolean(liveParentThreadId && task && navigation);
  return (
    <button
      type="button"
      className={`subagent-task-card${historical ? ' subagent-task-card--historical' : ''}`}
      disabled={!canOpen}
      title={historical ? translate('feature.collaboration.card.historicalTitle') : undefined}
      onClick={() => {
        if (liveParentThreadId && task && navigation) navigation(liveParentThreadId, task);
      }}
    >
      <AgentAvatar identity={identity} size={30} />
      <strong className="subagent-task-card__name">
        {identity.displayName || translate('feature.collaboration.card.unnamedAgent')}
      </strong>
      <SubagentTaskStatus status={status} translate={translate} showLabel={false} />
    </button>
  );
}
