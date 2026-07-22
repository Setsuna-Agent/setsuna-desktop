import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  BroadEscalatedPrefixExecModelClient,
  InMemoryPersistentToolApprovalStore,
  RepeatedAdditionalPermissionsExecModelClient,
  RepeatedEscalatedPrefixExecModelClient,
} from '../../support/agent-loop/approval.js';
import {
  AdditionalPermissionsExecToolHost,
  ApprovalToolHost,
  ApprovalToolModelClient,
  EscalatedExecModelClient,
  EscalatedExecToolHost,
  InMemoryPolicyAmendmentStore,
  mkDataDir,
  waitForApprovalToolRun,
  waitForPendingApproval
} from '../../support/agent-loop/shared.js';

describe('agent loop tool approval', () => {
  it('pauses tool execution until approval is answered', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Approval loop' });
      const modelClient = new ApprovalToolModelClient();
      const toolHost = new ApprovalToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run risky tool' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(toolHost.calls).toEqual([]);
      expect(pendingApproval.toolName).toBe('dangerous_tool');
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
      expect(modelClient.requests).toHaveLength(2);
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('approved result'))).toBe(true);
      const startedIndex = events.findIndex((event) => event.type === 'tool.started' && event.payload.toolName === 'dangerous_tool');
      const approvalIndex = events.findIndex((event) => event.type === 'approval.requested');
      expect(startedIndex).toBeGreaterThanOrEqual(0);
      expect(approvalIndex).toBeGreaterThanOrEqual(0);
      expect(startedIndex).toBeLessThan(approvalIndex);
      expect(events.some((event) => event.type === 'approval.requested')).toBe(true);
      expect(events.some((event) => event.type === 'tool.completed' && event.payload.status === 'success')).toBe(true);
    });
  
  it('persists tool approvals across loop instances', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Persistent approval loop' });
      const persistentToolApprovalStore = new InMemoryPersistentToolApprovalStore();
      const approvalKeys = ['mcp:search:write_note'];
      const firstModelClient = new ApprovalToolModelClient();
      const firstToolHost = new ApprovalToolHost({
        approvalKeys,
        persistentApprovalKeys: approvalKeys,
      });
      const firstApprovalGate = new InMemoryApprovalGate(systemClock, ids);
      const firstLoop = new AgentLoop({
        threadStore,
        modelClient: firstModelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost: firstToolHost,
        approvalGate: firstApprovalGate,
        persistentToolApprovalStore,
      });
  
      const pendingTurn = firstLoop.sendTurn(thread.id, { input: 'run risky MCP tool and remember' });
      const pendingApproval = await waitForPendingApproval(firstApprovalGate);
      expect(pendingApproval.availableDecisions).toEqual([
        { type: 'approve' },
        { type: 'approve_for_session' },
        { type: 'approve_persistently' },
        { type: 'reject' },
      ]);
      await firstApprovalGate.answerApproval(pendingApproval.id, { decision: 'approve_persistently' });
      await pendingTurn;
  
      const secondToolHost = new ApprovalToolHost({
        approvalKeys,
        persistentApprovalKeys: approvalKeys,
      });
      const secondApprovalGate = new InMemoryApprovalGate(systemClock, ids);
      const secondLoop = new AgentLoop({
        threadStore,
        modelClient: new ApprovalToolModelClient(),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost: secondToolHost,
        approvalGate: secondApprovalGate,
        persistentToolApprovalStore,
      });
  
      await secondLoop.sendTurn(thread.id, { input: 'run risky MCP tool again' });
  
      expect(firstToolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
      expect(secondToolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
      await expect(persistentToolApprovalStore.hasAll(approvalKeys)).resolves.toBe(true);
      await expect(secondApprovalGate.listApprovals()).resolves.toEqual({ approvals: [] });
    });
  
  it('cancels the active turn when command approval is cancelled', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Approval cancel loop' });
      const modelClient = new ApprovalToolModelClient();
      const toolHost = new ApprovalToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run risky tool then cancel' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'cancel' });
      await pendingTurn;
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([]);
      expect(events.some((event) => event.type === 'approval.resolved' && event.payload.approvalId === pendingApproval.id && event.payload.decision === 'cancel')).toBe(true);
      expect(events.some((event) => event.type === 'turn.cancelled' && event.payload.reason?.includes('approval decision'))).toBe(true);
      expect(events.some((event) => event.type === 'tool.completed' && event.payload.toolName === 'dangerous_tool')).toBe(false);
      await expect(approvalGate.listApprovals()).resolves.toEqual({
        approvals: [expect.objectContaining({ id: pendingApproval.id, decision: 'cancel', status: 'cancelled' })],
      });
      expect(modelClient.requests).toHaveLength(1);
    });
  
  it('runs exec_command with require_escalated as a bypassed sandbox attempt after approval', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Escalated exec loop' });
      const modelClient = new EscalatedExecModelClient();
      const toolHost = new EscalatedExecToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run escalated command' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(pendingApproval.toolName).toBe('exec_command');
      expect(pendingApproval.reason).toContain('needs unsandboxed access');
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
  
      expect(toolHost.attempts).toEqual(['bypass']);
      expect(modelClient.requests).toHaveLength(2);
    });
  
  it('reuses exec prefix_rule approvals for matching require_escalated commands', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Escalated prefix exec loop' });
      const modelClient = new RepeatedEscalatedPrefixExecModelClient();
      const toolHost = new EscalatedExecToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const policyAmendmentStore = new InMemoryPolicyAmendmentStore();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        policyAmendmentStore,
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run escalated prefix commands' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(pendingApproval.toolName).toBe('exec_command');
      expect(pendingApproval.proposedExecPolicyAmendment).toEqual(['git', 'status']);
      expect(pendingApproval.availableDecisions).toEqual([
        { type: 'approve' },
        { type: 'approve_exec_policy_amendment', proposedExecPolicyAmendment: ['git', 'status'] },
        { type: 'reject' },
      ]);
      const approvalRun = await waitForApprovalToolRun(
        threadStore,
        thread.id,
        pendingApproval.id,
        (run) => Array.isArray(run.proposedExecPolicyAmendment),
      );
      expect(approvalRun?.proposedExecPolicyAmendment).toEqual(['git', 'status']);
      expect(approvalRun?.availableApprovalDecisions).toEqual(pendingApproval.availableDecisions);
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_exec_policy_amendment' });
      await pendingTurn;
      const approvals = await approvalGate.listApprovals();
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.attempts).toEqual(['bypass', 'bypass']);
      expect(approvals.approvals).toHaveLength(1);
      expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
      expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_exec_policy_amendment')).toBe(true);
      await expect(policyAmendmentStore.listPolicyAmendments()).resolves.toMatchObject({
        execPolicyAmendments: [['git', 'status']],
      });
    });
  
  it('does not reuse banned broad exec prefix_rule approvals', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Broad prefix exec loop' });
      const modelClient = new BroadEscalatedPrefixExecModelClient();
      const toolHost = new EscalatedExecToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run broad prefix commands' });
      const firstApproval = await waitForPendingApproval(approvalGate);
  
      expect(firstApproval.toolName).toBe('exec_command');
      expect(firstApproval.proposedExecPolicyAmendment).toBeUndefined();
      await approvalGate.answerApproval(firstApproval.id, { decision: 'approve_for_session' });
      const secondApproval = await waitForPendingApproval(approvalGate);
      expect(secondApproval.id).not.toBe(firstApproval.id);
      expect(secondApproval.toolName).toBe('exec_command');
      await approvalGate.answerApproval(secondApproval.id, { decision: 'approve' });
      await pendingTurn;
  
      const events = await threadStore.listEvents(thread.id, 0);
      expect(toolHost.attempts).toEqual(['bypass', 'bypass']);
      expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(2);
    });
  
  it('runs exec_command with approved additional sandbox permissions', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Additional permissions exec loop', projectId: 'project_1' });
      const environmentCwd = await mkDataDir();
      const expectedWritableRoot = path.join(environmentCwd, 'extra-write');
      const modelClient = new RepeatedAdditionalPermissionsExecModelClient('extra-write');
      const toolHost = new AdditionalPermissionsExecToolHost(environmentCwd);
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run command with additional permissions twice' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(pendingApproval.toolName).toBe('exec_command');
      expect(pendingApproval.reason).toContain('Additional sandbox permissions requested');
      expect(pendingApproval.reason).toContain('network access');
      expect(pendingApproval.reason).toContain(expectedWritableRoot);
      expect(pendingApproval.environmentId).toBe('project_1');
      expect(pendingApproval.additionalPermissions).toEqual({
        network: { enabled: true },
        file_system: {
          write: [expectedWritableRoot],
          entries: [{
            path: { type: 'path', path: expectedWritableRoot },
            access: 'write',
          }],
        },
      });
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
      await pendingTurn;
      const approvals = await approvalGate.listApprovals();
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.contexts).toHaveLength(2);
      expect(toolHost.contexts.every((context) => context.sandbox?.mode === 'default')).toBe(true);
      expect(toolHost.contexts.every((context) => context.sandboxWorkspaceWrite?.networkAccess === true)).toBe(true);
      expect(toolHost.contexts.every((context) => context.sandboxWorkspaceWrite?.writableRoots?.includes(expectedWritableRoot))).toBe(true);
      expect(approvals.approvals).toHaveLength(1);
      expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
      expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_for_session')).toBe(true);
    });
});
