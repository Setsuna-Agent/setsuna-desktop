import { describe, expect, it } from 'vitest';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  EscalatedNetworkDeniedModelClient,
  EscalatedNetworkRetryToolHost,
  NetworkDeniedModelClient,
  NetworkRetryToolHost,
  PolicyAwareShellNetworkRetryToolHost,
  RepeatedHostNetworkShellModelClient,
  RepeatedNetworkDeniedModelClient,
  RepeatedSandboxDeniedModelClient,
  SandboxDeniedModelClient,
  SandboxRetryToolHost,
  ShellNetworkRetryToolHost,
} from '../../support/agent-loop/sandbox-network.js';
import {
  FullApprovalConfigStore,
  InMemoryPolicyAmendmentStore,
  mkDataDir,
  waitForApprovalToolRun,
  waitForPendingApproval
} from '../../support/agent-loop/shared.js';

describe('agent loop sandbox and network retries', () => {
  it('retries a sandbox-denied tool after bypass approval', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Sandbox retry loop' });
      const modelClient = new SandboxDeniedModelClient();
      const toolHost = new SandboxRetryToolHost();
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
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run sandboxed tool' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(toolHost.attempts).toEqual(['default']);
      expect(pendingApproval.toolName).toBe('sandboxed_tool');
      expect(pendingApproval.reason).toContain('Sandbox denied sandboxed_tool');
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.attempts).toEqual(['default', 'bypass']);
      expect(events.some((event) => event.type === 'approval.resolved' && event.payload.approvalId === pendingApproval.id && event.payload.decision === 'approve')).toBe(true);
      expect(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.toolName === 'sandboxed_tool'
        && event.payload.status === 'success'
        && event.payload.content.includes('retried without sandbox')
      )).toBe(true);
    });
  
  it('starts without a sandbox or prompt under full access', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Full-policy sandbox retry loop' });
      const toolHost = new SandboxRetryToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient: new SandboxDeniedModelClient(),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new FullApprovalConfigStore('danger-full-access'),
      });
  
      await loop.sendTurn(thread.id, { input: 'run sandboxed tool with full approval' });
  
      expect(toolHost.attempts).toEqual(['bypass']);
      await expect(approvalGate.listApprovals()).resolves.toEqual({ approvals: [] });
      const events = await threadStore.listEvents(thread.id, 0);
      expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
    });
  
  it('caches sandbox retry approvals when approved for session', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Session sandbox retry loop' });
      const modelClient = new RepeatedSandboxDeniedModelClient();
      const toolHost = new SandboxRetryToolHost();
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
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run sandboxed tool twice' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
      await pendingTurn;
      const approvals = await approvalGate.listApprovals();
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.attempts).toEqual(['default', 'bypass', 'default', 'bypass']);
      expect(modelClient.requests).toHaveLength(3);
      expect(approvals.approvals).toHaveLength(1);
      expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
      expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_for_session')).toBe(true);
    });
  
  it('retries a network-denied tool after network approval', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Network retry loop' });
      const modelClient = new NetworkDeniedModelClient();
      const toolHost = new NetworkRetryToolHost();
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
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run network tool' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(toolHost.attempts).toEqual(['default']);
      expect(pendingApproval.toolName).toBe('network_tool');
      expect(pendingApproval.reason).toContain('Network access is blocked for network_tool');
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.attempts).toEqual(['default', 'enabled']);
      expect(events.some((event) => event.type === 'approval.resolved' && event.payload.approvalId === pendingApproval.id && event.payload.decision === 'approve')).toBe(true);
      expect(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.toolName === 'network_tool'
        && event.payload.status === 'success'
        && event.payload.content.includes('retried with network')
      )).toBe(true);
    });
  
  it('preserves require_escalated sandbox intent when retrying after network approval', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Escalated network retry loop' });
      const modelClient = new EscalatedNetworkDeniedModelClient();
      const toolHost = new EscalatedNetworkRetryToolHost();
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
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run escalated network command' });
      const execApproval = await waitForPendingApproval(approvalGate);
      expect(execApproval.reason).toContain('needs unsandboxed network access');
      await approvalGate.answerApproval(execApproval.id, { decision: 'approve' });
      const networkApproval = await waitForPendingApproval(approvalGate);
      expect(networkApproval.reason).toContain('Network access');
      await approvalGate.answerApproval(networkApproval.id, { decision: 'approve' });
      await pendingTurn;
  
      expect(toolHost.attempts).toEqual([
        { mode: 'bypass', networkAccess: 'default' },
        { mode: 'bypass', networkAccess: 'enabled' },
      ]);
    });
  
  it('caches network retry approvals when approved for session', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Session network approval loop' });
      const modelClient = new RepeatedNetworkDeniedModelClient();
      const toolHost = new NetworkRetryToolHost();
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
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run network tool twice' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
      await pendingTurn;
      const approvals = await approvalGate.listApprovals();
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.attempts).toEqual(['default', 'enabled', 'enabled']);
      expect(modelClient.requests).toHaveLength(3);
      expect(approvals.approvals).toHaveLength(1);
      expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
      expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_for_session')).toBe(true);
    });
  
  it('scopes shell network approvals to exact commands while retaining a host deny option', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Host network approval loop', projectId: 'project_1' });
      const modelClient = new RepeatedHostNetworkShellModelClient();
      const toolHost = new ShellNetworkRetryToolHost();
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
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'fetch two URLs from the same host' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(pendingApproval.toolName).toBe('run_shell_command');
      expect(pendingApproval.reason).toContain('entire command');
      expect(pendingApproval.argumentsPreview).toContain('curl https://api.example.com/a');
      expect(pendingApproval.networkApprovalContext).toEqual({
        host: 'api.example.com',
        protocol: 'https',
        port: 443,
        target: 'https://api.example.com:443',
      });
      expect(pendingApproval.proposedNetworkPolicyAmendments).toEqual([
        { host: 'api.example.com', action: 'deny' },
      ]);
      expect(pendingApproval.availableDecisions).toEqual([
        { type: 'approve' },
        { type: 'approve_for_session' },
        { type: 'approve_network_policy_amendment', networkPolicyAmendment: { host: 'api.example.com', action: 'deny' } },
        { type: 'reject' },
      ]);
      const approvalRun = await waitForApprovalToolRun(
        threadStore,
        thread.id,
        pendingApproval.id,
        (run) => Boolean(run.networkApprovalContext && run.proposedNetworkPolicyAmendments && run.availableApprovalDecisions),
      );
      expect(approvalRun?.networkApprovalContext).toEqual(pendingApproval.networkApprovalContext);
      expect(approvalRun?.proposedNetworkPolicyAmendments).toEqual(pendingApproval.proposedNetworkPolicyAmendments);
      expect(approvalRun?.availableApprovalDecisions).toEqual(pendingApproval.availableDecisions);
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
      const secondApproval = await waitForPendingApproval(approvalGate);
      expect(secondApproval.id).not.toBe(pendingApproval.id);
      expect(secondApproval.argumentsPreview).toContain('curl https://api.example.com/b');
      await approvalGate.answerApproval(secondApproval.id, { decision: 'approve' });
      await pendingTurn;
      const approvals = await approvalGate.listApprovals();
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.attempts).toEqual([
        { command: 'curl https://api.example.com/a', networkAccess: 'default' },
        { command: 'curl https://api.example.com/a', networkAccess: 'enabled' },
        { command: 'curl https://api.example.com/b', networkAccess: 'default' },
        { command: 'curl https://api.example.com/b', networkAccess: 'enabled' },
      ]);
      expect(approvals.approvals).toHaveLength(2);
      expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(2);
      expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_for_session')).toBe(true);
      await expect(policyAmendmentStore.listPolicyAmendments()).resolves.toMatchObject({
        networkPolicyAmendments: [],
      });
    });
  
  it('persists network deny amendments and skips later prompts for the same host', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Host network deny policy loop', projectId: 'project_1' });
      const modelClient = new RepeatedHostNetworkShellModelClient();
      const policyAmendmentStore = new InMemoryPolicyAmendmentStore();
      const toolHost = new PolicyAwareShellNetworkRetryToolHost(policyAmendmentStore);
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
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
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'deny repeated host network commands' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
      await approvalGate.answerApproval(pendingApproval.id, {
        decision: 'approve_network_policy_amendment',
        networkPolicyAmendment: { host: 'api.example.com', action: 'deny' },
      });
      await pendingTurn;
  
      const approvals = await approvalGate.listApprovals();
      const events = await threadStore.listEvents(thread.id, 0);
      expect(toolHost.attempts).toEqual([
        { command: 'curl https://api.example.com/a', networkAccess: 'default' },
        { command: 'curl https://api.example.com/b', networkAccess: 'default' },
      ]);
      expect(approvals.approvals).toHaveLength(1);
      expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'tool.completed' && event.payload.status === 'error')).toHaveLength(2);
      await expect(policyAmendmentStore.listPolicyAmendments()).resolves.toMatchObject({
        networkPolicyAmendments: [{ host: 'api.example.com', action: 'deny' }],
      });
    });
});
