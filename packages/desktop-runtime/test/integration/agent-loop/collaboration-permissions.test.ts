import type { ModelRequest, ModelStreamEvent, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { bindTestCollaborationFeature, childThreadIdFromCollaborationToolMessages, hasToolMessage, MultiAgentConfigStore } from '../../support/agent-loop/collaboration.js';
import { mkDataDir, TestConfigStore, waitForPendingApproval } from '../../support/agent-loop/shared.js';
import { createHost } from '../adapters/tool/pc-local-tool-host.support.js';

function writeCall(id: string) {
  return { id, name: 'write_file', arguments: JSON.stringify({ file_path: `${id}.txt`, content: id }) };
}

function isChild(request: ModelRequest) {
  return request.messages.some((message) => message.inputKind === 'subagent_task');
}

describe('collaboration permission inheritance', () => {
  it.each(['workspace-write', 'danger-full-access', 'read-only'] as const)('applies %s to the parent, spawned and resumed child, and refreshes settings on direct resume', async (permissionProfile) => {
    const { host, fixtureRoot, projectDir, projectId } = await createHost();
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(path.join(fixtureRoot, 'loop-data'), systemClock, ids);
    const parent = await store.createThread({ title: 'Parent', projectId });
    const config: RuntimeConfigState = {
      ...await new MultiAgentConfigStore().getConfig(), permissionProfile,
      approvalPolicy: permissionProfile === 'danger-full-access' ? 'full' : 'on-request',
      sandboxWorkspaceWrite: { networkAccess: true, writableRoots: [projectDir] },
    };
    const approvals = new InMemoryApprovalGate(systemClock, ids);
    const listedTools = vi.spyOn(host, 'listTools');
    const loop = new AgentLoop({
      threadStore: store, ids, clock: systemClock, eventBus: new InMemoryEventBus(), toolHost: host,
      configStore: new TestConfigStore(config), approvalGate: approvals,
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        let call;
        if (isChild(request)) {
          const stage = request.messages.some((message) => message.content === 'Write direct result') ? 'direct'
            : request.messages.some((message) => message.content === 'Write resumed result') ? 'resumed' : 'spawned';
          if (!request.messages.some((message) => message.toolCallId === stage)) call = writeCall(stage);
        } else if (!request.messages.some((message) => message.toolCallId === 'parent')) {
          call = writeCall('parent');
        } else {
          const childId = childThreadIdFromCollaborationToolMessages(request.messages);
          if (!childId) call = { id: 'spawn', name: 'spawn_agent', arguments: '{"prompt":"Write spawned result"}' };
          else if (!request.messages.some((message) => message.toolCallId === 'wait_initial')) {
            call = { id: 'wait_initial', name: 'wait', arguments: JSON.stringify({ thread_id: childId }) };
          } else if (!hasToolMessage(request.messages, 'resume_agent')) {
            call = { id: 'resume', name: 'resume_agent', arguments: JSON.stringify({ thread_id: childId, content: 'Write resumed result' }) };
          }
        }
        if (call) {
          yield { type: 'tool_calls', toolCalls: [call] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else {
          yield { type: 'text_delta', text: 'Finished assigned work' };
          yield { type: 'done', finishReason: 'stop' };
        }
      } },
    });
    bindTestCollaborationFeature(loop, store);
    try {
      await loop.sendTurn(parent.id, { input: 'Write parent and child results' });
      const [child] = await store.listThreads({ parentThreadId: parent.id });
      expect(child).toMatchObject({ projectId, parentThreadId: parent.id });
      for (const stage of ['parent', 'spawned', 'resumed']) {
        const file = readFile(path.join(projectDir, `${stage}.txt`), 'utf8');
        if (permissionProfile === 'read-only') await expect(file).rejects.toMatchObject({ code: 'ENOENT' });
        else await expect(file).resolves.toBe(stage);
      }
      const childContexts = listedTools.mock.calls.map(([context]) => context).filter((context) => context.threadId === child!.id);
      expect(childContexts.length).toBeGreaterThan(0);
      for (const context of childContexts) {
        expect(context).toMatchObject({ permissionProfile, sandboxWorkspaceWrite: config.sandboxWorkspaceWrite });
        expect(context.readOnly).not.toBe(true);
      }

      // Permission changes affect both ordinary turns and reused children, rather than pinning a child to its birth policy.
      config.permissionProfile = permissionProfile === 'read-only' ? 'workspace-write' : 'read-only';
      await loop.sendTurn(child!.id, { input: 'Write direct result' });
      const directFile = readFile(path.join(projectDir, 'direct.txt'), 'utf8');
      if (config.permissionProfile === 'read-only') await expect(directFile).rejects.toMatchObject({ code: 'ENOENT' });
      else await expect(directFile).resolves.toBe('direct');
      const saved = await store.getThread(child!.id);
      expect(saved?.messages.find((message) => message.content === 'Write direct result')).toMatchObject({ inputKind: 'subagent_task', promptSource: 'collaboration' });
      expect(saved?.turns?.at(-1)?.taskKind).toBe('subagent');
      expect((await approvals.listApprovals()).approvals).toEqual([]);
    } finally {
      await loop.shutdown();
      await host.shutdown();
      await store.close();
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { reviewer: 'user', decision: 'approve' },
    { reviewer: 'user', decision: 'reject' },
    { reviewer: 'automatic', decision: 'approve' },
  ] as const)('keeps strict $reviewer approval for child writes ($decision)', async ({ reviewer, decision }) => {
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const parent = await store.createThread({ title: 'Parent approval policy' });
    const config: RuntimeConfigState = {
      ...await new MultiAgentConfigStore().getConfig(), approvalPolicy: 'strict', approvalReviewer: reviewer,
    };
    const approvals = new InMemoryApprovalGate(systemClock, ids);
    const runTool = vi.fn(async () => ({ content: 'Write executed' }));
    const review = vi.fn(async () => ({ assessment: {
      status: 'allowed' as const, riskLevel: 'low' as const, userAuthorization: 'high' as const, rationale: 'Approved test action',
    } }));
    const loop = new AgentLoop({
      threadStore: store, ids, clock: systemClock, eventBus: new InMemoryEventBus(),
      configStore: new TestConfigStore(config), approvalGate: approvals,
      toolHost: { listTools: async () => [{ name: 'write_file', description: 'Write', inputSchema: { type: 'object' } }], runTool },
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        const call = isChild(request)
          ? !hasToolMessage(request.messages, 'write_file') ? writeCall('child_write') : null
          : !childThreadIdFromCollaborationToolMessages(request.messages)
            ? { id: 'spawn', name: 'spawn_agent', arguments: '{"prompt":"Write the requested file"}' } : null;
        if (call) {
          yield { type: 'tool_calls', toolCalls: [call] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else {
          yield { type: 'text_delta', text: 'Completed coordination' };
          yield { type: 'done', finishReason: 'stop' };
        }
      } },
    });
    bindTestCollaborationFeature(loop, store);
    loop.bindApprovalReviewControl({ available: true, review });
    try {
      const running = loop.sendTurn(parent.id, { input: 'Have a child write the requested file' });
      if (reviewer === 'user') {
        const approval = await waitForPendingApproval(approvals);
        expect(approval).toMatchObject({ toolName: 'write_file', reviewer: 'user' });
        expect(approval.threadId).not.toBe(parent.id);
        expect(runTool).not.toHaveBeenCalled();
        await approvals.answerApproval(approval.id, { decision });
      }
      await running;
      const [child] = await store.listThreads({ parentThreadId: parent.id });
      expect(runTool).toHaveBeenCalledTimes(decision === 'approve' ? 1 : 0);
      expect(review).toHaveBeenCalledTimes(reviewer === 'automatic' ? 1 : 0);
      expect((await approvals.listApprovals()).approvals).toEqual([expect.objectContaining({
        threadId: child!.id, reviewer, status: decision === 'approve' ? 'approved' : 'rejected',
      })]);
    } finally { await loop.shutdown(); await store.close(); }
  });
});
