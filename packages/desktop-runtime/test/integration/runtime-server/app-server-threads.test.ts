import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRuntimeServerTestHarness,
  mediumIntegrationTestTimeoutMs,
  type RuntimeServerTestHarness,
} from '../../support/runtime-server/harness.js';
import {
  createDelayedOpenAiCaptureServer,
  RuntimeEventStream,
  withTimeout
} from '../../support/runtime-server/shared.js';

describe('runtime server AppServer thread lifecycle', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('deletes AppServer threads from thread/read, thread/list, and loaded-list results', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Deleted AppServer RPC thread', cwd: process.cwd() });
      const deletedStream = await harness.openRuntimeEventStream(
        startedThread.thread.id,
        0,
        { format: 'swe' },
      );
  
      try {
        await expect(harness.appServerRpc('thread/delete', { threadId: startedThread.thread.id })).resolves.toEqual({});
        await expect(deletedStream.readContains('"method":"thread/deleted"')).resolves.toBe(true);
      } finally {
        await deletedStream.close();
      }
  
      await expect(harness.appServerRpcEnvelope({
        id: 'read_deleted',
        method: 'thread/read',
        params: { threadId: startedThread.thread.id },
      })).resolves.toMatchObject({
        id: 'read_deleted',
        error: { code: -32004, message: 'Thread not found' },
      });
      const listed = await harness.appServerRpc('thread/list', {});
      expect(listed.data.some((thread: { id: string }) => thread.id === startedThread.thread.id)).toBe(false);
      const loaded = await harness.appServerRpc('thread/loaded/list', {});
      expect(loaded.data).not.toContain(startedThread.thread.id);
    });
  
  it('drains an active AppServer turn before deletion and removes its scoped temporary workspace', async () => {
      const capture = await createDelayedOpenAiCaptureServer();
      let stream: RuntimeEventStream | undefined;
      try {
        await harness.configureOpenAiProvider('delete-active-provider', capture.baseUrl);
        const startedThread = await harness.appServerRpc('thread/start', { name: 'Delete active AppServer thread' });
        const threadId = startedThread.thread.id as string;
        const workspaceStatus = await harness.runtimeFetch(`/v1/workspace/status?threadId=${encodeURIComponent(threadId)}`);
        const workspacePath = workspaceStatus.project.path as string;
        await writeFile(path.join(workspacePath, 'delete-marker.txt'), 'delete with thread\n');
        stream = await harness.openRuntimeEventStream(threadId, 0);
  
        await harness.appServerRpc('turn/start', {
          threadId,
          input: [{ type: 'text', text: 'Remain active until deletion.' }],
        });
        await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for active deletion provider request');
  
        await expect(harness.appServerRpc('thread/delete', { threadId })).resolves.toEqual({});
        await expect(stream.readContains('"type":"thread.deleted"')).resolves.toBe(true);
        await expect(access(workspacePath)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(harness.appServerRpcEnvelope({
          id: 'read_active_deleted',
          method: 'thread/read',
          params: { threadId },
        })).resolves.toMatchObject({
          id: 'read_active_deleted',
          error: { code: -32004, message: 'Thread not found' },
        });
  
        // A late write from the deleted task would poison the shared RuntimeEventWriter. Prove a
        // subsequent thread can still persist through that same writer instance.
        const surviving = await harness.appServerRpc('thread/start', { name: 'Surviving thread' });
        await expect(harness.appServerRpc('thread/name/set', {
          threadId: surviving.thread.id,
          name: 'Writer remains healthy',
        })).resolves.toEqual({});
        await expect(harness.appServerRpc('thread/read', { threadId: surviving.thread.id })).resolves.toMatchObject({
          thread: { name: 'Writer remains healthy' },
        });
      } finally {
        await stream?.close();
        capture.release();
        await capture.close();
      }
    }, mediumIntegrationTestTimeoutMs);
  
  it('injects AppServer response items as hidden model-visible history', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Injected AppServer RPC thread', cwd: process.cwd() });
  
      await expect(harness.appServerRpc('thread/inject_items', {
        threadId: startedThread.thread.id,
        items: [
          {
            id: 'injected_boundary',
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Side conversation boundary.' }],
          },
          {
            id: 'injected_assistant',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Injected assistant context.' }],
          },
          {
            id: 'injected_call',
            type: 'function_call',
            call_id: 'call_injected',
            name: 'workspace_search_text',
            arguments: '{"query":"needle"}',
          },
          {
            id: 'injected_output',
            type: 'function_call_output',
            call_id: 'call_injected',
            output: 'hidden search result',
          },
        ],
      })).resolves.toEqual({});
  
      const thread = (await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(startedThread.thread.id)}`)) as RuntimeThread;
      expect(thread.messageCount).toBe(0);
      expect(thread.lastMessagePreview).toBe('');
      expect(thread.messages).toEqual([
        expect.objectContaining({ id: 'injected_boundary', role: 'user', content: 'Side conversation boundary.', visibility: 'model' }),
        expect.objectContaining({ id: 'injected_assistant', role: 'assistant', content: 'Injected assistant context.', visibility: 'model' }),
        expect.objectContaining({
          id: 'injected_call',
          role: 'assistant',
          visibility: 'model',
          toolCalls: [{ id: 'call_injected', name: 'workspace_search_text', arguments: '{"query":"needle"}' }],
        }),
        expect.objectContaining({ id: 'injected_output', role: 'tool', toolCallId: 'call_injected', content: 'hidden search result', visibility: 'model' }),
      ]);
  
      const read = await harness.appServerRpc('thread/read', { threadId: startedThread.thread.id, includeTurns: true });
      expect(read.thread.turns).toEqual([]);
  
      await expect(harness.appServerRpcEnvelope({
        id: 'inject_bad_item',
        method: 'thread/inject_items',
        params: {
          threadId: startedThread.thread.id,
          items: [{ type: 'reasoning', summary: [] }],
        },
      })).resolves.toMatchObject({
        id: 'inject_bad_item',
        error: { code: -32602, message: expect.stringContaining('not a supported response item') },
      });
    });
  
  it('sets, reads, updates, and clears AppServer thread goals', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Goal AppServer RPC thread', cwd: process.cwd() });
      const updatedStream = await harness.openRuntimeEventStream(
        startedThread.thread.id,
        0,
        { format: 'swe' },
      );
  
      let set!: Record<string, any>;
      try {
        set = await harness.appServerRpc('thread/goal/set', {
          threadId: startedThread.thread.id,
          objective: 'Ship AppServer alignment.',
          status: 'active',
          tokenBudget: 1000,
        });
        await expect(updatedStream.readContains('"method":"thread/goal/updated"')).resolves.toBe(true);
      } finally {
        await updatedStream.close();
      }
      expect(set.goal).toMatchObject({
        threadId: startedThread.thread.id,
        objective: 'Ship AppServer alignment.',
        status: 'active',
        tokenBudget: 1000,
        tokensUsed: 0,
        timeUsedSeconds: 0,
      });
  
      await expect(harness.appServerRpc('thread/goal/get', { threadId: startedThread.thread.id })).resolves.toEqual({
        goal: set.goal,
      });
  
      const edited = await harness.appServerRpc('thread/goal/set', {
        threadId: startedThread.thread.id,
        status: 'paused',
      });
      expect(edited.goal).toMatchObject({
        threadId: startedThread.thread.id,
        objective: 'Ship AppServer alignment.',
        status: 'paused',
        tokenBudget: 1000,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: set.goal.createdAt,
      });
  
      const clearedStream = await harness.openRuntimeEventStream(
        startedThread.thread.id,
        0,
        { format: 'swe' },
      );
      try {
        await expect(harness.appServerRpc('thread/goal/clear', { threadId: startedThread.thread.id })).resolves.toEqual({ cleared: true });
        await expect(clearedStream.readContains('"method":"thread/goal/cleared"')).resolves.toBe(true);
      } finally {
        await clearedStream.close();
      }
      await expect(harness.appServerRpc('thread/goal/get', { threadId: startedThread.thread.id })).resolves.toEqual({ goal: null });
      await expect(harness.appServerRpc('thread/goal/clear', { threadId: startedThread.thread.id })).resolves.toEqual({ cleared: false });
    });
  
  it('returns AppServer goal validation errors for invalid thread goal requests', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Invalid goal AppServer RPC thread', cwd: process.cwd() });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'goal_missing_objective',
        method: 'thread/goal/set',
        params: { threadId: startedThread.thread.id, status: 'active' },
      })).resolves.toMatchObject({
        id: 'goal_missing_objective',
        error: { code: -32602, message: expect.stringContaining('no goal exists') },
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'goal_bad_budget',
        method: 'thread/goal/set',
        params: { threadId: startedThread.thread.id, objective: 'Ship it', tokenBudget: 0 },
      })).resolves.toMatchObject({
        id: 'goal_bad_budget',
        error: { code: -32602, message: 'goal budgets must be positive when provided' },
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'goal_bad_status',
        method: 'thread/goal/set',
        params: { threadId: startedThread.thread.id, objective: 'Ship it', status: 'unknown' },
      })).resolves.toMatchObject({
        id: 'goal_bad_status',
        error: { code: -32602, message: 'Unsupported goal status: unknown' },
      });
    });
  
  it('patches AppServer thread git metadata and returns updated thread shapes', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Metadata AppServer RPC thread', cwd: process.cwd() });
  
      const updated = await harness.appServerRpc('thread/metadata/update', {
        threadId: startedThread.thread.id,
        gitInfo: {
          branch: 'feature/sidebar-pr',
        },
      });
      expect(updated.thread).toMatchObject({
        id: startedThread.thread.id,
        sessionId: startedThread.thread.sessionId,
        gitInfo: {
          sha: null,
          branch: 'feature/sidebar-pr',
          originUrl: null,
        },
        status: { type: 'idle' },
      });
  
      const read = await harness.appServerRpc('thread/read', { threadId: startedThread.thread.id });
      expect(read.thread.gitInfo).toEqual({
        sha: null,
        branch: 'feature/sidebar-pr',
        originUrl: null,
      });
      const listed = await harness.appServerRpc('thread/list', {});
      expect(listed.data.find((thread: { id: string }) => thread.id === startedThread.thread.id)).toMatchObject({
        gitInfo: {
          sha: null,
          branch: 'feature/sidebar-pr',
          originUrl: null,
        },
      });
  
      const cleared = await harness.appServerRpc('thread/metadata/update', {
        threadId: startedThread.thread.id,
        gitInfo: {
          branch: null,
        },
      });
      expect(cleared.thread.gitInfo).toBeNull();
      await expect(harness.appServerRpc('thread/read', { threadId: startedThread.thread.id })).resolves.toMatchObject({
        thread: { gitInfo: null },
      });
    });
  
  it('returns AppServer metadata validation errors for invalid gitInfo patches', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Invalid metadata AppServer RPC thread', cwd: process.cwd() });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'metadata_missing_git_info',
        method: 'thread/metadata/update',
        params: { threadId: startedThread.thread.id },
      })).resolves.toMatchObject({
        id: 'metadata_missing_git_info',
        error: { code: -32602, message: 'gitInfo must include at least one field' },
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'metadata_empty_git_info',
        method: 'thread/metadata/update',
        params: { threadId: startedThread.thread.id, gitInfo: {} },
      })).resolves.toMatchObject({
        id: 'metadata_empty_git_info',
        error: { code: -32602, message: 'gitInfo must include at least one field' },
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'metadata_empty_branch',
        method: 'thread/metadata/update',
        params: { threadId: startedThread.thread.id, gitInfo: { branch: '   ' } },
      })).resolves.toMatchObject({
        id: 'metadata_empty_branch',
        error: { code: -32602, message: 'gitInfo.branch must not be empty' },
      });
    });
  
  it('rolls back trailing AppServer turns and returns populated thread history', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Rollback AppServer RPC thread', cwd: process.cwd() });
      const firstTurn = await harness.appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        input: [{ type: 'text', text: 'First local smoke response.' }],
      });
      await harness.waitForThread(
        startedThread.thread.id,
        (item) => item.messages.some((message) => message.turnId === firstTurn.turn.id && message.role === 'assistant' && message.status === 'complete'),
      );
      const secondTurn = await harness.appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        input: [{ type: 'text', text: 'Second local smoke response.' }],
      });
      await harness.waitForThread(
        startedThread.thread.id,
        (item) => item.messages.some((message) => message.turnId === secondTurn.turn.id && message.role === 'assistant' && message.status === 'complete'),
      );
  
      const rolledBack = await harness.appServerRpc('thread/rollback', {
        threadId: startedThread.thread.id,
        numTurns: 1,
      });
  
      expect(rolledBack.thread.turns).toEqual([expect.objectContaining({
        id: firstTurn.turn.id,
        items: expect.arrayContaining([
          expect.objectContaining({ type: 'userMessage' }),
          expect.objectContaining({ type: 'agentMessage' }),
        ]),
      })]);
      expect(rolledBack.thread.turns.some((turn: { id: string }) => turn.id === secondTurn.turn.id)).toBe(false);
  
      const resumed = await harness.appServerRpc('thread/resume', { threadId: startedThread.thread.id });
      expect(resumed.thread.turns.map((turn: { id: string }) => turn.id)).toEqual([firstTurn.turn.id]);
    });
  
  it('returns JSON-RPC method errors from the AppServer app-server adapter', async () => {
      const response = await harness.appServerRpcEnvelope({ id: 99, method: 'missing/method', params: {} });
      expect(response).toEqual({
        id: 99,
        error: {
          code: -32601,
          message: 'Method not found: missing/method',
        },
      });
    });
});
