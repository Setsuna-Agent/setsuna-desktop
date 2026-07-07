import type { RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { dispatchAppServerRpcRequest } from './dispatcher.js';

describe('AppServer dispatcher rollback', () => {
  it('cancels an active turn before computing the rollback boundary', async () => {
    const calls: string[] = [];
    const beforeCancel = runtimeThread([
      runtimeMessage('msg_user_1', 'turn_1', 'user', 'first'),
      runtimeMessage('msg_assistant_1', 'turn_1', 'assistant', 'first answer'),
      runtimeMessage('msg_user_2', 'turn_2', 'user', 'second'),
      runtimeMessage('msg_assistant_2', 'turn_2', 'assistant', 'second answer'),
      runtimeMessage('msg_user_3', 'turn_3', 'user', 'active'),
    ]);
    const afterCancel = runtimeThread([
      ...beforeCancel.messages,
      {
        ...runtimeMessage('msg_abort_3', 'turn_3', 'user', '<turn_aborted>\nTurn cancelled.\n</turn_aborted>'),
        visibility: 'model',
      },
    ]);
    const rolledBack = runtimeThread(beforeCancel.messages.slice(0, 4));

    let current = beforeCancel;
    const runtime = {
      agentLoop: {
        activeTurnId(threadId: string) {
          calls.push(`active:${threadId}`);
          return 'turn_3';
        },
        async cancelTurn(threadId: string, turnId: string) {
          calls.push(`cancel:${threadId}:${turnId}`);
          current = afterCancel;
          return true;
        },
      },
      threadStore: {
        async getThread(threadId: string) {
          calls.push(`get:${threadId}`);
          return current;
        },
        async truncateMessagesAfter(threadId: string, messageId: string, includeSelf: boolean) {
          calls.push(`truncate:${threadId}:${messageId}:${String(includeSelf)}`);
          return rolledBack;
        },
      },
    };

    const result = await dispatchAppServerRpcRequest(
      runtime as any,
      'thread/rollback',
      { threadId: 'thread_1', numTurns: 1 },
      { dataDir: '/tmp/setsuna-test', token: 'token', version: 'test' },
      {} as any,
      {} as any,
    ) as { thread: { turns: Array<{ id: string }> } };

    expect(calls).toEqual([
      'get:thread_1',
      'active:thread_1',
      'cancel:thread_1:turn_3',
      'get:thread_1',
      'truncate:thread_1:msg_user_3:true',
    ]);
    expect(result.thread.turns.map((turn) => turn.id)).toEqual(['turn_1', 'turn_2']);
  });
});

function runtimeThread(messages: RuntimeMessage[]): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-07T00:00:03.000Z',
    archived: false,
    messageCount: messages.length,
    lastMessagePreview: messages.at(-1)?.content ?? '',
    lastSeq: messages.length,
    messages,
  };
}

function runtimeMessage(id: string, turnId: string, role: RuntimeMessage['role'], content: string): RuntimeMessage {
  return {
    id,
    turnId,
    role,
    content,
    createdAt: `2026-07-07T00:00:${id.at(-1) ?? '0'}.000Z`,
    status: 'complete',
  };
}
