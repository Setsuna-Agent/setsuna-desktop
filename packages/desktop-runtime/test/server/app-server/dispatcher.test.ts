import type { RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { dispatchAppServerRpcRequest } from '../../../src/server/app-server/dispatcher.js';

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
        withThreadMutation: (_threadId: string, operation: () => Promise<unknown>) => operation(),
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

describe('AppServer dispatcher thread deletion', () => {
  it('commits deletion before publishing the drained sequence and cleans only scoped resources', async () => {
    const calls: string[] = [];
    const thread = { ...runtimeThread([]), lastSeq: 9 };
    let deleted = false;
    let publishedSeq: number | undefined;
    const runtime = {
      agentLoop: {
        async withThreadDeletionBarrier(_threadId: string, operation: () => Promise<unknown>) {
          calls.push('barrier:start');
          const result = await operation();
          calls.push('barrier:end');
          return result;
        },
        clearAppServerDynamicTools(threadId: string) {
          calls.push(`tools:${threadId}`);
        },
      },
      mcpConnections: {
        async releaseThread(threadId: string) {
          calls.push(`mcp:${threadId}`);
        },
      },
      threadStore: {
        async getThread(threadId: string) {
          calls.push(`get:${threadId}`);
          return thread;
        },
        async deleteThread(threadId: string) {
          calls.push(`delete:${threadId}`);
          deleted = true;
        },
      },
      eventBus: {
        publish(event: { seq: number; type: string }) {
          expect(deleted).toBe(true);
          calls.push(`publish:${event.type}`);
          publishedSeq = event.seq;
        },
      },
      attachmentStore: {
        async releaseThread(threadId: string) {
          calls.push(`attachments:${threadId}`);
        },
      },
      workspaceProjects: {
        async removeTemporaryWorkspace(input: { threadId: string; createdAt: string }) {
          calls.push(`workspace:${input.threadId}:${input.createdAt}`);
        },
      },
    };

    await expect(dispatchAppServerRpcRequest(
      runtime as any,
      'thread/delete',
      { threadId: thread.id },
      { dataDir: '/tmp/setsuna-test', token: 'token', version: 'test' },
      {} as any,
      {} as any,
    )).resolves.toEqual({});

    expect(publishedSeq).toBe(10);
    expect(calls).toEqual([
      'barrier:start',
      'get:thread_1',
      'delete:thread_1',
      'publish:thread.deleted',
      'tools:thread_1',
      'mcp:thread_1',
      'attachments:thread_1',
      'workspace:thread_1:2026-07-07T00:00:00.000Z',
      'barrier:end',
    ]);
  });

  it('reports post-commit cleanup failures without making deletion retryable', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const thread = runtimeThread([]);
    const cleanups: string[] = [];
    const runtime = {
      agentLoop: {
        withThreadDeletionBarrier: (_threadId: string, operation: () => Promise<unknown>) => operation(),
        clearAppServerDynamicTools: () => {
          cleanups.push('tools');
          throw new Error('dynamic tools are locked');
        },
      },
      mcpConnections: {
        releaseThread: async () => {
          cleanups.push('mcp');
        },
      },
      threadStore: {
        getThread: async () => thread,
        deleteThread: async () => undefined,
      },
      eventBus: { publish: () => undefined },
      attachmentStore: {
        releaseThread: async () => {
          cleanups.push('attachments');
        },
      },
      workspaceProjects: {
        removeTemporaryWorkspace: async () => {
          cleanups.push('workspace');
          throw new Error('workspace is locked');
        },
      },
    };

    try {
      await expect(dispatchAppServerRpcRequest(
        runtime as any,
        'thread/delete',
        { threadId: thread.id },
        { dataDir: '/tmp/setsuna-test', token: 'token', version: 'test' },
        {} as any,
        {} as any,
      )).resolves.toEqual({});
      expect(cleanups).toEqual(['tools', 'mcp', 'attachments', 'workspace']);
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('dynamic tools cleanup failed'),
        expect.objectContaining({ message: 'dynamic tools are locked' }),
      );
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('temporary workspace cleanup failed'),
        expect.objectContaining({ message: 'workspace is locked' }),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('does not tear down thread resources when the delete commit fails', async () => {
    const calls: string[] = [];
    const thread = runtimeThread([]);
    const runtime = {
      agentLoop: {
        withThreadDeletionBarrier: (_threadId: string, operation: () => Promise<unknown>) => operation(),
        clearAppServerDynamicTools: () => calls.push('tools'),
      },
      mcpConnections: { releaseThread: async () => { calls.push('mcp'); } },
      threadStore: {
        getThread: async () => thread,
        deleteThread: async () => {
          calls.push('delete');
          throw new Error('delete commit failed');
        },
      },
      eventBus: { publish: () => calls.push('publish') },
      attachmentStore: { releaseThread: async () => { calls.push('attachments'); } },
      workspaceProjects: { removeTemporaryWorkspace: async () => { calls.push('workspace'); } },
    };

    await expect(dispatchAppServerRpcRequest(
      runtime as any,
      'thread/delete',
      { threadId: thread.id },
      { dataDir: '/tmp/setsuna-test', token: 'token', version: 'test' },
      {} as any,
      {} as any,
    )).rejects.toThrow('delete commit failed');
    expect(calls).toEqual(['delete']);
  });
});

describe('AppServer dispatcher direct thread mutation', () => {
  it('runs thread name updates inside the AgentLoop mutation boundary', async () => {
    const calls: string[] = [];
    const thread = runtimeThread([]);
    const runtime = {
      agentLoop: {
        async withThreadMutation(threadId: string, operation: () => Promise<unknown>) {
          calls.push(`mutation:start:${threadId}`);
          const result = await operation();
          calls.push(`mutation:end:${threadId}`);
          return result;
        },
      },
      threadStore: {
        async getThread(threadId: string) {
          calls.push(`get:${threadId}`);
          return thread;
        },
        async updateThread(threadId: string, patch: { title: string }) {
          calls.push(`update:${threadId}:${patch.title}`);
          return { ...thread, title: patch.title };
        },
      },
    };

    await expect(dispatchAppServerRpcRequest(
      runtime as any,
      'thread/name/set',
      { threadId: thread.id, name: 'Admitted name' },
      { dataDir: '/tmp/setsuna-test', token: 'token', version: 'test' },
      {} as any,
      {} as any,
    )).resolves.toEqual({});
    expect(calls).toEqual([
      'mutation:start:thread_1',
      'get:thread_1',
      'update:thread_1:Admitted name',
      'mutation:end:thread_1',
    ]);
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
