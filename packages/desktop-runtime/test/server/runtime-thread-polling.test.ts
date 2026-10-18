import type { RuntimeThread } from '@setsuna-desktop/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { handleRuntimeThreadRequest } from '../../src/server/runtime-thread-routes.js';
import { handleRuntimeWorkspaceRequest } from '../../src/server/runtime-workspace-routes.js';
import type { RuntimeFactory } from '../../src/server/types.js';

describe('lightweight thread polling', () => {
  const thread: RuntimeThread = {
    id: 'thread_1', title: 'Large thread', lastSeq: 42, createdAt: '', updatedAt: '', archived: false,
    workspaceId: 'workspace_1', projectId: 'project_1', messages: [], messageCount: 430, lastMessagePreview: '',
  };
  function fixture(lastSeq = 42, activeTurnId: string | null = 'turn_1') {
    const getThreadPage = vi.fn(async () => ({ ...thread, lastSeq }));
    const getThread = vi.fn(async () => { throw new Error('Should not clone full history'); });
    const getStatus = vi.fn(async () => ({ exists: true }));
    const runtime = {
      threadStore: { getThreadMetadata: vi.fn(async () => ({ ...thread, lastSeq })), getThreadPage, getThread },
      agentLoop: { activeTurnId: () => activeTurnId },
      workspaceProjects: { getStatus },
    } as unknown as RuntimeFactory;
    const response = { writeHead: vi.fn(), end: vi.fn() };
    return { runtime, response, getThreadPage, getThread, getStatus };
  }
  const request = { method: 'GET' } as IncomingMessage;

  it('does not load history when both event sequence and active turn match', async () => {
    const { runtime, response, getThreadPage, getThread } = fixture();
    await handleRuntimeThreadRequest(runtime, request, response as unknown as ServerResponse,
      new URL('http://localhost/v1/threads/thread_1?messageLimit=160&knownSeq=42&knownActiveTurnId=turn_1'));
    expect(response.end).toHaveBeenCalledWith('null\n');
    expect(getThreadPage).not.toHaveBeenCalled();
    expect(getThread).not.toHaveBeenCalled();
  });

  it.each([[43, 'turn_1'], [42, null], [42, 'turn_2']] as const)('recovers a missed event or turn transition (%s, %s)', async (seq, turn) => {
    const { runtime, response, getThreadPage } = fixture(seq, turn);
    await handleRuntimeThreadRequest(runtime, request, response as unknown as ServerResponse,
      new URL('http://localhost/v1/threads/thread_1?messageLimit=160&knownSeq=42&knownActiveTurnId=turn_1'));
    expect(getThreadPage).toHaveBeenCalledWith('thread_1', { limit: 160 });
    expect(JSON.parse(response.end.mock.calls[0][0])).toMatchObject({ lastSeq: seq, activeTurnId: turn });
  });

  it('reads workspace ownership without loading messages or undo patches', async () => {
    const { runtime, response, getThread, getStatus } = fixture();
    await handleRuntimeWorkspaceRequest(runtime, request, response as unknown as ServerResponse,
      new URL('http://localhost/v1/workspace/status?threadId=thread_1'));
    expect(getThread).not.toHaveBeenCalled();
    expect(getStatus).toHaveBeenCalledWith('workspace_1', 'project_1');
  });
});
