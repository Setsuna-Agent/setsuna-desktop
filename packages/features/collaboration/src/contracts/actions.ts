import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { agentRecord, agentText } from './agents.js';

export type CollaborationUserAction = Readonly<{
  threadId: string;
  childThreadId: string;
  action: 'send' | 'interrupt' | 'resume' | 'close';
  content?: string;
  /** Prevent a stale panel action from targeting a newly started execution. */
  expectedTurnId: string | null;
}>;

export type CollaborationActionResult = Readonly<{ turnId: string | null }>;

const userActionCodec = defineRuntimeCodec<CollaborationUserAction>((value) => {
  const record = agentRecord(value);
  if (!['send', 'interrupt', 'resume', 'close'].includes(String(record.action))) throw new Error('Invalid collaboration action.');
  const action = record.action as CollaborationUserAction['action'];
  return { threadId: agentText(record.threadId, 256), childThreadId: agentText(record.childThreadId, 256), action,
    ...((action === 'send' || action === 'resume') ? { content: agentText(record.content, 8000) } : {}),
    expectedTurnId: record.expectedTurnId === null ? null : agentText(record.expectedTurnId, 256),
  };
});

export const actOnCollaborationTask = defineFeatureOperation({
  id: 'collaboration.task.act', method: 'POST', path: '/v1/features/collaboration/threads/:threadId/tasks/:childThreadId/actions',
  input: userActionCodec,
  output: defineRuntimeCodec<CollaborationActionResult>((value) => {
    const record = agentRecord(value);
    return { turnId: record.turnId === null ? null : agentText(record.turnId, 256) };
  }),
  errors: { THREAD_NOT_FOUND: { status: 404 }, TASK_CONFLICT: { status: 409 } },
  idempotency: 'non-idempotent',
});
