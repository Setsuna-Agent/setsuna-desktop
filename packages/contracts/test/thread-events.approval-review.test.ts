import type { RuntimeEvent, RuntimeThread } from '../src/index.js';
import { describe, expect, it } from 'vitest';
import { applyRuntimeEventToThread } from '../src/thread-events.js';

describe('approval review event projection', () => {
  it('keeps the automatic reviewer, decision source, risk, and rationale on the tool run', () => {
    const requested = applyRuntimeEventToThread(threadFixture(), {
      id: 'event_requested',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.requested',
      createdAt: '2026-08-13T00:00:01.000Z',
      payload: {
        approval: {
          id: 'approval_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          toolCallId: 'call_1',
          toolName: 'exec_command',
          reason: 'Escalation required.',
          argumentsPreview: '{"cmd":"pnpm test"}',
          reviewer: 'automatic',
          status: 'pending',
          createdAt: '2026-08-13T00:00:01.000Z',
        },
      },
    } satisfies RuntimeEvent);
    const resolved = applyRuntimeEventToThread(requested, {
      id: 'event_resolved',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.resolved',
      createdAt: '2026-08-13T00:00:02.000Z',
      payload: {
        approvalId: 'approval_1',
        decision: 'reject',
        message: 'The destination is not authorized.',
        source: 'automatic',
        assessment: {
          status: 'denied',
          riskLevel: 'high',
          userAuthorization: 'unknown',
          rationale: 'The destination is not authorized.',
          model: 'approval-review-model',
        },
      },
    } satisfies RuntimeEvent);
    const overrideRegistered = applyRuntimeEventToThread(resolved, {
      id: 'event_override',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.override_registered',
      createdAt: '2026-08-13T00:00:03.000Z',
      payload: { approvalId: 'approval_1' },
    } satisfies RuntimeEvent);

    expect(overrideRegistered.messages[0]?.toolRuns?.[0]).toMatchObject({
      approvalReviewer: 'automatic',
      approvalStatus: 'rejected',
      approvalMessage: 'The destination is not authorized.',
      approvalResolutionSource: 'automatic',
      approvalReviewAssessment: {
        status: 'denied',
        riskLevel: 'high',
        rationale: 'The destination is not authorized.',
      },
      approvalReviewOverrideRegistered: true,
    });
    expect(overrideRegistered.messages[0]?.toolRuns?.[0]?.resultPreview).toBeUndefined();

    const retryCompleted = applyRuntimeEventToThread(overrideRegistered, {
      id: 'event_retry_completed',
      seq: 4,
      threadId: 'thread_1',
      turnId: 'turn_retry',
      type: 'turn.completed',
      createdAt: '2026-08-13T00:00:04.000Z',
      payload: {},
    } satisfies RuntimeEvent);
    expect(retryCompleted.messages[0]?.toolRuns?.[0]?.approvalReviewOverrideRegistered).toBeUndefined();
  });

  it('keeps a technical failure visible while replacing it with a pending user approval', () => {
    const automaticallyRequested = applyRuntimeEventToThread(threadFixture(), approvalRequestedEvent({
      approvalId: 'approval_auto',
      reviewer: 'automatic',
    }));
    const automaticallyFailed = applyRuntimeEventToThread(automaticallyRequested, {
      id: 'event_auto_failed',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.resolved',
      createdAt: '2026-08-13T00:00:02.000Z',
      payload: {
        approvalId: 'approval_auto',
        decision: 'reject',
        message: 'Automatic approval review failed: reviewer unavailable',
        source: 'automatic',
        assessment: {
          status: 'failed',
          rationale: 'Automatic approval review failed: reviewer unavailable',
        },
      },
    } satisfies RuntimeEvent);
    const awaitingUser = applyRuntimeEventToThread(automaticallyFailed, approvalRequestedEvent({
      approvalId: 'approval_user',
      reviewer: 'user',
      seq: 3,
    }));

    expect(awaitingUser.messages[0]?.toolRuns?.[0]).toMatchObject({
      approvalId: 'approval_user',
      approvalReviewer: 'user',
      approvalStatus: 'pending',
      approvalMessage: 'Automatic approval review failed: reviewer unavailable',
      approvalReviewAssessment: {
        status: 'failed',
        rationale: 'Automatic approval review failed: reviewer unavailable',
      },
      status: 'pending_approval',
    });
    expect(awaitingUser.messages[0]?.toolRuns?.[0]?.completedAt).toBeUndefined();
  });
});

function approvalRequestedEvent({
  approvalId,
  reviewer,
  seq = 1,
}: {
  approvalId: string;
  reviewer: 'automatic' | 'user';
  seq?: number;
}): RuntimeEvent {
  return {
    id: `event_requested_${seq}`,
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'approval.requested',
    createdAt: `2026-08-13T00:00:0${seq}.000Z`,
    payload: {
      approval: {
        id: approvalId,
        threadId: 'thread_1',
        turnId: 'turn_1',
        toolCallId: 'call_1',
        toolName: 'exec_command',
        reason: 'Escalation required.',
        argumentsPreview: '{"cmd":"pnpm test"}',
        reviewer,
        status: 'pending',
        createdAt: `2026-08-13T00:00:0${seq}.000Z`,
      },
    },
  };
}

function threadFixture(): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    archived: false,
    messageCount: 1,
    lastMessagePreview: '',
    lastSeq: 0,
    messages: [{
      id: 'assistant_1',
      role: 'assistant',
      turnId: 'turn_1',
      content: '',
      createdAt: '2026-08-13T00:00:00.000Z',
      status: 'streaming',
    }],
  };
}
