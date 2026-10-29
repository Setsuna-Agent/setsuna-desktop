import type { DesktopRuntimeClient } from '@setsuna-desktop/contracts';
import type { CollaborationTask } from '@setsuna-desktop/feature-collaboration/contracts';
import { Button, ToastNotice } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import { useCollaborationFeatureNavigation, useCollaborationFeatureState } from '../../composition/CollaborationFeatureBoundary.js';
import { ChatThreadProvider } from './conversation/ChatThreadProvider.js';
import { useObservedRuntimeThread } from './hooks/useObservedRuntimeThread.js';
import { RuntimeToolRuns } from './tool-runs/RuntimeToolRuns.js';

/** Subscribe only to children waiting for approval, without opening their panel or scanning history at startup. */
export function CollaborationApprovals({ parentThreadId, client }: Readonly<{ parentThreadId: string; client: DesktopRuntimeClient }>) {
  const { state } = useCollaborationFeatureState(parentThreadId);
  const waiting = state.tasks.filter((task) => task.status === 'waiting_approval');
  if (!waiting.length) return null;
  return <div className="collaboration-approvals">{waiting.map((task) => (
    <ChildApprovals key={task.childThreadId} parentThreadId={parentThreadId} task={task} client={client} />
  ))}</div>;
}

function ChildApprovals({ parentThreadId, task, client }: Readonly<{ parentThreadId: string; task: CollaborationTask; client: DesktopRuntimeClient }>) {
  const [error, setError] = useState<string | null>(null);
  const child = useObservedRuntimeThread({ threadId: task.childThreadId, client, onError: setError });
  const navigation = useCollaborationFeatureNavigation();
  const runs = child.currentThread?.messages.filter((message) => message.turnId === task.activeTurnId)
    .flatMap((message) => message.toolRuns ?? [])
    .filter((run) => run.approvalStatus === 'pending' && run.approvalReviewer !== 'automatic') ?? [];
  return <>
    {runs.length ? <section>
      <Button variant="ghost" onClick={() => navigation?.openTask(parentThreadId, task)}>{task.identity.displayName}</Button>
      <ChatThreadProvider threadId={task.childThreadId}>
        {runs.map((run) => <RuntimeToolRuns key={run.approvalId} runs={[run]} onAnswerApproval={child.answerApproval} />)}
      </ChatThreadProvider>
    </section> : null}
    {error ? <ToastNotice tone="error" message={error} /> : null}
  </>;
}
