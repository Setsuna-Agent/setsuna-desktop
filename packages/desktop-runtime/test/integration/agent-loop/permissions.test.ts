import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  contentIncludesPath,
  ProtectedAdditionalPermissionsExecModelClient,
  RequestPermissionsDisabledConfigStore,
  RequestPermissionsExecToolHost,
  RequestPermissionsThenExecModelClient,
  SessionRequestPermissionsModelClient,
} from '../../support/agent-loop/permissions.js';
import {
  AdditionalPermissionsExecToolHost,
  mkDataDir,
  ReadOnlyConfigStore,
  waitForPendingApproval
} from '../../support/agent-loop/shared.js';

describe('agent loop permission grants', () => {
  it('applies request_permissions grants to later exec_command calls in the same turn', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Request permissions loop', projectId: 'project_1' });
      const environmentCwd = await mkDataDir();
      const grantedRoot = 'relative-grant';
      const deniedRoot = 'blocked-grant';
      const deniedSpecialRoot = 'blocked-special';
      const deniedGlobPattern = '**/*.env';
      const expectedGrantedRoot = path.join(environmentCwd, grantedRoot);
      const expectedDeniedRoot = path.join(environmentCwd, deniedRoot);
      const expectedDeniedSpecialRoot = path.join(environmentCwd, deniedSpecialRoot);
      const expectedDeniedGlobPattern = path.join(environmentCwd, deniedGlobPattern);
      const modelClient = new RequestPermissionsThenExecModelClient(grantedRoot, {
        deniedRoot,
        deniedSpecialRoot,
        deniedGlobPattern,
      });
      const toolHost = new RequestPermissionsExecToolHost(environmentCwd, 'environment_1');
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new ReadOnlyConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'request permission then run command' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
      expect(pendingApproval).toMatchObject({
        toolName: 'request_permissions',
        status: 'pending',
        permissionApprovalContext: {
          cwd: environmentCwd,
          environmentId: 'environment_1',
          availableScopes: ['turn', 'session'],
        },
      });
      expect(pendingApproval.permissionApprovalContext?.grantedPermissions).toMatchObject({
        network: { enabled: true },
      });
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
      const saved = await threadStore.getThread(thread.id);
      const approvalRun = saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'request_permissions');
  
      expect(toolHost.contexts).toHaveLength(1);
      expect(toolHost.contexts[0].permissionProfile).toBe('read-only');
      expect(toolHost.contexts[0].sandbox?.networkAccess).toBe('enabled');
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.readableRoots).toContain(expectedGrantedRoot);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toContain(expectedGrantedRoot);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.deniedRoots).toContain(expectedDeniedRoot);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.deniedRoots).toContain(expectedDeniedSpecialRoot);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.deniedGlobPatterns).toContain(expectedDeniedGlobPattern);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.networkAccess).toBe(true);
      expect(approvalRun?.permissionApprovalContext?.cwd).toBe(environmentCwd);
      expect(approvalRun?.permissionApprovalContext?.grantedPermissions).toMatchObject({
        file_system: { read: [expectedGrantedRoot], write: [expectedGrantedRoot] },
      });
      expect(approvalRun?.permissionApprovalContext?.grantedPermissions).toMatchObject({
        file_system: {
          entries: expect.arrayContaining([
            { path: { type: 'path', path: expectedDeniedRoot }, access: 'deny' },
            { path: { type: 'path', path: expectedDeniedSpecialRoot }, access: 'deny' },
            { path: { type: 'glob_pattern', pattern: expectedDeniedGlobPattern }, access: 'deny' },
          ]),
        },
      });
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && contentIncludesPath(message.content, expectedGrantedRoot))).toBe(true);
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"scope":"turn"'))).toBe(true);
    });
  
  it('auto-denies request_permissions when the feature is disabled', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Disabled request permissions loop', projectId: 'project_1' });
      const environmentCwd = await mkDataDir();
      const modelClient = new RequestPermissionsThenExecModelClient('disabled-grant');
      const toolHost = new RequestPermissionsExecToolHost(environmentCwd);
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new RequestPermissionsDisabledConfigStore(),
      });
  
      await loop.sendTurn(thread.id, { input: 'request permission while disabled' });
  
      await expect(approvalGate.listApprovals()).resolves.toEqual({ approvals: [] });
      expect(toolHost.contexts).toHaveLength(1);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toBeUndefined();
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.readableRoots).toBeUndefined();
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.networkAccess).toBeUndefined();
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"permissions":{}'))).toBe(true);
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"scope":"turn"'))).toBe(true);
    });
  
  it('clamps request_permissions approval grants to the originally requested permissions', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Clamped request permissions loop', projectId: 'project_1' });
      const environmentCwd = await mkDataDir();
      const grantedRoot = 'requested-grant';
      const requestedRoot = path.join(environmentCwd, grantedRoot);
      const modelClient = new RequestPermissionsThenExecModelClient(grantedRoot);
      const toolHost = new RequestPermissionsExecToolHost(environmentCwd);
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new ReadOnlyConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'request permission then clamp the grant' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
      await approvalGate.answerApproval(pendingApproval.id, {
        decision: 'approve_for_session',
        permissionGrant: {
          permissions: {
            network: { enabled: true },
            file_system: {
              write: [environmentCwd],
              read: [environmentCwd],
            },
          },
          scope: 'session',
        },
      });
      await pendingTurn;
  
      expect(toolHost.contexts).toHaveLength(1);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toEqual([requestedRoot]);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.readableRoots).toEqual([requestedRoot]);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.networkAccess).toBe(true);
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && contentIncludesPath(message.content, requestedRoot))).toBe(true);
      expect(modelClient.requests[1].messages.some((message) =>
        message.role === 'tool'
        && contentIncludesPath(message.content, environmentCwd)
        && !contentIncludesPath(message.content, requestedRoot)
      )).toBe(false);
    });
  
  it('enables strict auto review for later tools in the same request_permissions turn', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Strict request permissions loop', projectId: 'project_1' });
      const environmentCwd = await mkDataDir();
      const grantedRoot = 'strict-grant';
      const modelClient = new RequestPermissionsThenExecModelClient(grantedRoot);
      const toolHost = new RequestPermissionsExecToolHost(environmentCwd);
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new ReadOnlyConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'request permission then strictly review command' });
      const permissionsApproval = await waitForPendingApproval(approvalGate);
      expect(permissionsApproval.toolName).toBe('request_permissions');
      expect(permissionsApproval.availableDecisions).toEqual([
        { type: 'approve' },
        { type: 'approve_for_turn_with_strict_auto_review' },
        { type: 'approve_for_session' },
        { type: 'reject' },
      ]);
  
      await approvalGate.answerApproval(permissionsApproval.id, { decision: 'approve_for_turn_with_strict_auto_review' });
      const execApproval = await waitForPendingApproval(approvalGate);
      expect(execApproval.id).not.toBe(permissionsApproval.id);
      expect(execApproval.toolName).toBe('exec_command');
      expect(execApproval.reason).toContain('Strict auto review');
  
      await approvalGate.answerApproval(execApproval.id, { decision: 'approve' });
      await pendingTurn;
  
      const approvals = await approvalGate.listApprovals();
      expect(approvals.approvals.map((approval) => approval.toolName)).toEqual(['exec_command', 'request_permissions']);
      expect(toolHost.contexts).toHaveLength(1);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toContain(path.join(environmentCwd, grantedRoot));
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"strict_auto_review":true'))).toBe(true);
    });
  
  it('normalizes session-scoped strict request_permissions responses to an empty turn grant', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Invalid strict session permissions loop', projectId: 'project_1' });
      const environmentCwd = await mkDataDir();
      const grantedRoot = 'strict-session-grant';
      const modelClient = new RequestPermissionsThenExecModelClient(grantedRoot);
      const toolHost = new RequestPermissionsExecToolHost(environmentCwd);
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new ReadOnlyConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'request invalid strict session permissions' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
      await approvalGate.answerApproval(pendingApproval.id, {
        decision: 'approve_for_session',
        permissionGrant: {
          permissions: {
            network: { enabled: true },
            file_system: { write: [path.join(environmentCwd, grantedRoot)] },
          },
          scope: 'session',
          strictAutoReview: true,
        },
      });
      await pendingTurn;
  
      expect(toolHost.contexts).toHaveLength(1);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toBeUndefined();
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.networkAccess).toBeUndefined();
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"permissions":{}'))).toBe(true);
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"scope":"turn"'))).toBe(true);
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"strict_auto_review":false'))).toBe(true);
    });
  
  it('keeps request_permissions grants when approved for session', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Session request permissions loop', projectId: 'project_1' });
      const grantedRoot = path.join(await mkDataDir(), 'setsuna-request-permissions-session');
      const modelClient = new SessionRequestPermissionsModelClient(grantedRoot);
      const toolHost = new RequestPermissionsExecToolHost();
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
  
      const firstTurn = loop.sendTurn(thread.id, { input: 'request session permission' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
      await firstTurn;
  
      await loop.sendTurn(thread.id, { input: 'reuse session permission' });
  
      const approvals = await approvalGate.listApprovals();
      expect(approvals.approvals).toHaveLength(1);
      expect(toolHost.contexts).toHaveLength(1);
      expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toContain(grantedRoot);
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"scope":"session"'))).toBe(true);
    });
  
  it('rejects additional sandbox write permissions for protected metadata', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Protected additional permissions loop', projectId: 'project_1' });
      const modelClient = new ProtectedAdditionalPermissionsExecModelClient();
      const toolHost = new AdditionalPermissionsExecToolHost();
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
  
      await loop.sendTurn(thread.id, { input: 'run command with unsafe additional permissions' });
      const approvals = await approvalGate.listApprovals();
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.contexts).toHaveLength(0);
      expect(approvals.approvals).toHaveLength(0);
      expect(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.toolName === 'exec_command'
        && event.payload.status === 'rejected'
        && event.payload.content.includes('protected workspace metadata')
      )).toBe(true);
    });
});
