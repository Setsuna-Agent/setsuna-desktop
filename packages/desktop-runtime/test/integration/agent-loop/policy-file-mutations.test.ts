import { describe, expect, it } from 'vitest';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  EmptyAdditionalPermissionsExecModelClient,
  ProtectedMetadataWriteModelClient,
  RepeatedFileWriteModelClient,
  ShellApplyPatchInterceptHost,
  ShellApplyPatchModelClient,
  ShellMentionApplyPatchModelClient
} from '../../support/agent-loop/policy-file-mutations.js';
import {
  AdditionalPermissionsExecToolHost,
  ApprovalToolHost,
  ApprovalToolModelClient,
  CapturingToolHost,
  EscalatedExecModelClient,
  EscalatedExecToolHost,
  FullApprovalConfigStore,
  HooksConfigStore,
  mkDataDir,
  nodeEvalHook,
  PreviewingToolHost,
  ReadOnlyConfigStore,
  StrictApprovalConfigStore,
  ToolCallingModelClient,
  ToolDeltaModelClient,
  waitForPendingApproval
} from '../../support/agent-loop/shared.js';

describe('agent loop tool policy and file mutations', () => {
  it('requires approval for every tool when approval policy is strict', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Strict approval loop', projectId: 'project_1' });
      const modelClient = new ToolCallingModelClient();
      const toolHost = new CapturingToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new StrictApprovalConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'read README strictly' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(toolHost.calls).toEqual([]);
      expect(pendingApproval.toolName).toBe('workspace_read_file');
      expect(pendingApproval.reason).toContain('Strict approval policy');
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
  
      expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
    });
  
  it('lets PermissionRequest hooks approve tools before user approval UI', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Permission hook allow' });
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
        configStore: new HooksConfigStore({
          PermissionRequest: [{
            matcher: 'dangerous_tool',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }));"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'run risky tool with hook allow' });
      const saved = await threadStore.getThread(thread.id);
      const approvals = await approvalGate.listApprovals();
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
      expect(approvals.approvals).toEqual([]);
      expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'hook.completed',
        payload: expect.objectContaining({
          eventName: 'PermissionRequest',
          toolName: 'dangerous_tool',
          status: 'completed',
          message: 'Approved by hook.',
        }),
      }));
      expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'dangerous_tool')?.hookRuns).toMatchObject([
        { eventName: 'PermissionRequest', status: 'completed', message: 'Approved by hook.' },
      ]);
    });
  
  it('lets PermissionRequest hooks deny tools before user approval UI', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Permission hook deny' });
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
        configStore: new HooksConfigStore({
          PermissionRequest: [{
            matcher: 'dangerous_tool',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'denied by permission hook' } } }));"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'run risky tool with hook deny' });
      const saved = await threadStore.getThread(thread.id);
      const approvals = await approvalGate.listApprovals();
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([]);
      expect(approvals.approvals).toEqual([]);
      expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool.completed',
        payload: expect.objectContaining({
          toolName: 'dangerous_tool',
          status: 'rejected',
          content: expect.stringContaining('denied by permission hook'),
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'hook.completed',
        payload: expect.objectContaining({
          eventName: 'PermissionRequest',
          toolName: 'dangerous_tool',
          status: 'blocked',
          message: 'denied by permission hook',
          entries: [{ kind: 'feedback', text: 'denied by permission hook' }],
        }),
      }));
      expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'dangerous_tool')?.hookRuns).toMatchObject([
        { eventName: 'PermissionRequest', status: 'blocked', message: 'denied by permission hook', entries: [{ kind: 'feedback', text: 'denied by permission hook' }] },
      ]);
    });
  
  it('marks invalid PermissionRequest hook output as failed and continues to approval UI', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Permission hook invalid' });
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
        configStore: new HooksConfigStore({
          PermissionRequest: [{
            matcher: 'dangerous_tool',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: {} } } }));"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'run risky tool with invalid hook allow' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
      const eventsBeforeApproval = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([]);
      expect(pendingApproval.toolName).toBe('dangerous_tool');
      expect(eventsBeforeApproval).toContainEqual(expect.objectContaining({
        type: 'hook.completed',
        payload: expect.objectContaining({
          eventName: 'PermissionRequest',
          toolName: 'dangerous_tool',
          status: 'failed',
          message: 'PermissionRequest hook returned unsupported updatedInput',
          entries: [{ kind: 'error', text: 'PermissionRequest hook returned unsupported updatedInput' }],
        }),
      }));
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
      const saved = await threadStore.getThread(thread.id);
  
      expect(toolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
      expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'dangerous_tool')?.hookRuns).toMatchObject([
        { eventName: 'PermissionRequest', status: 'failed', message: 'PermissionRequest hook returned unsupported updatedInput', entries: [{ kind: 'error', text: 'PermissionRequest hook returned unsupported updatedInput' }] },
      ]);
    });
  
  it('routes strict file mutations through the tool orchestrator approval flow', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Strict file write loop' });
      const modelClient = new ToolDeltaModelClient();
      const toolHost = new PreviewingToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new StrictApprovalConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'write file strictly' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(toolHost.calls).toBe(0);
      expect(pendingApproval.toolName).toBe('write_file');
      expect(pendingApproval.reason).toContain('Strict approval policy');
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
      const events = await threadStore.listEvents(thread.id, 0);
      const approvals = await approvalGate.listApprovals();
  
      expect(approvals.approvals).toHaveLength(1);
      expect(approvals.approvals[0]).toMatchObject({ toolName: 'write_file', status: 'approved' });
      expect(events.some((event) => event.type === 'approval.requested')).toBe(true);
      expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve')).toBe(true);
      expect(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.toolName === 'write_file'
        && event.payload.status === 'success'
      )).toBe(true);
    });
  
  it('caches strict file mutation approvals only when approved for session', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Session file approval loop' });
      const modelClient = new RepeatedFileWriteModelClient();
      const toolHost = new PreviewingToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new StrictApprovalConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'write same file twice with session approval' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
      await pendingTurn;
  
      const events = await threadStore.listEvents(thread.id, 0);
      const approvals = await approvalGate.listApprovals();
  
      expect(toolHost.calls).toBe(2);
      expect(approvals.approvals).toHaveLength(1);
      expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
      expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_for_session')).toBe(true);
      expect(events.filter((event) => event.type === 'tool.completed' && event.payload.toolName === 'write_file' && event.payload.status === 'success')).toHaveLength(2);
    });
  
  it('does not cache strict file mutation approvals for one-time approvals', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'One-time file approval loop' });
      const modelClient = new RepeatedFileWriteModelClient();
      const toolHost = new PreviewingToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new StrictApprovalConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'write same file twice with one-time approval' });
      const firstApproval = await waitForPendingApproval(approvalGate);
      await approvalGate.answerApproval(firstApproval.id, { decision: 'approve' });
      const secondApproval = await waitForPendingApproval(approvalGate);
      await approvalGate.answerApproval(secondApproval.id, { decision: 'approve' });
      await pendingTurn;
  
      const events = await threadStore.listEvents(thread.id, 0);
      const approvals = await approvalGate.listApprovals();
  
      expect(toolHost.calls).toBe(2);
      expect(approvals.approvals).toHaveLength(2);
      expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(2);
    });
  
  it('rejects file mutations before execution in read-only permission profile', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Read-only file write loop' });
      const modelClient = new ToolDeltaModelClient();
      const toolHost = new PreviewingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        configStore: new ReadOnlyConfigStore(),
      });
  
      await loop.sendTurn(thread.id, { input: 'write file read-only' });
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toBe(0);
      expect(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.toolName === 'write_file'
        && event.payload.status === 'rejected'
        && event.payload.content.includes('read-only permission profile')
      )).toBe(true);
    });
  
  it('rejects protected workspace metadata file mutations before execution', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Protected metadata write loop' });
      const modelClient = new ProtectedMetadataWriteModelClient();
      const toolHost = new PreviewingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });
  
      await loop.sendTurn(thread.id, { input: 'write git config' });
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toBe(0);
      expect(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.toolName === 'write_file'
        && event.payload.status === 'rejected'
        && event.payload.content.includes('protected workspace metadata')
      )).toBe(true);
    });
  
  it('intercepts shell apply_patch commands into the file mutation approval path', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Shell patch loop' });
      const modelClient = new ShellApplyPatchModelClient('src/from-shell.txt');
      const toolHost = new ShellApplyPatchInterceptHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new StrictApprovalConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'apply patch through shell' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(toolHost.calls).toEqual([]);
      expect(pendingApproval.toolName).toBe('apply_patch');
      expect(pendingApproval.argumentsPreview).toContain('src/from-shell.txt');
  
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([
        {
          name: 'apply_patch',
          input: expect.objectContaining({
            patch: expect.stringContaining('src/from-shell.txt'),
            intercepted_from_shell_command: true,
          }),
        },
      ]);
      expect(events.some((event) => event.type === 'tool.started' && event.payload.toolName === 'apply_patch')).toBe(true);
      expect(events.some((event) => event.type === 'tool.completed' && event.payload.toolName === 'apply_patch' && event.payload.status === 'success')).toBe(true);
      expect(events.some((event) => event.type === 'tool.completed' && event.payload.toolName === 'run_shell_command')).toBe(false);
    });
  
  it('preserves shell cd workdir when intercepting apply_patch commands', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Shell cd patch loop' });
      const modelClient = new ShellApplyPatchModelClient('from-shell-cd.txt', 'cd src && ');
      const toolHost = new ShellApplyPatchInterceptHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new StrictApprovalConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'apply patch through shell cd' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(pendingApproval.toolName).toBe('apply_patch');
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
  
      expect(toolHost.calls).toEqual([
        {
          name: 'apply_patch',
          input: expect.objectContaining({
            patch: expect.stringContaining('from-shell-cd.txt'),
            workdir: 'src',
            intercepted_from_shell_command: true,
          }),
        },
      ]);
    });
  
  it('intercepts shell applypatch alias commands into apply_patch', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Shell applypatch alias loop' });
      const modelClient = new ShellApplyPatchModelClient('src/from-alias.txt', '', 'applypatch');
      const toolHost = new ShellApplyPatchInterceptHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new StrictApprovalConfigStore(),
      });
  
      const pendingTurn = loop.sendTurn(thread.id, { input: 'apply patch through shell alias' });
      const pendingApproval = await waitForPendingApproval(approvalGate);
  
      expect(pendingApproval.toolName).toBe('apply_patch');
      await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
      await pendingTurn;
  
      expect(toolHost.calls).toEqual([
        {
          name: 'apply_patch',
          input: expect.objectContaining({
            patch: expect.stringContaining('src/from-alias.txt'),
            intercepted_from_shell_command: true,
          }),
        },
      ]);
    });
  
  it('rejects protected workspace metadata writes hidden in shell apply_patch commands', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Protected shell patch loop' });
      const modelClient = new ShellApplyPatchModelClient('.git/config');
      const toolHost = new ShellApplyPatchInterceptHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });
  
      await loop.sendTurn(thread.id, { input: 'hide git write in shell patch' });
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([]);
      expect(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.toolName === 'apply_patch'
        && event.payload.status === 'rejected'
        && event.payload.content.includes('protected workspace metadata')
      )).toBe(true);
    });
  
  it('does not intercept ordinary shell commands that merely mention apply_patch', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Shell search loop' });
      const modelClient = new ShellMentionApplyPatchModelClient();
      const toolHost = new ShellApplyPatchInterceptHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });
  
      await loop.sendTurn(thread.id, { input: 'search for apply_patch' });
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([
        {
          name: 'run_shell_command',
          input: expect.objectContaining({ command: 'rg apply_patch' }),
        },
      ]);
      expect(events.some((event) => event.type === 'tool.completed' && event.payload.toolName === 'run_shell_command' && event.payload.status === 'success')).toBe(true);
      expect(events.some((event) => event.type === 'tool.completed' && event.payload.toolName === 'apply_patch')).toBe(false);
    });
  
  it('skips tool approvals when approval policy is full', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Full approval loop' });
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
        configStore: new FullApprovalConfigStore(),
      });
  
      await loop.sendTurn(thread.id, { input: 'run risky tool without confirmation' });
      const events = await threadStore.listEvents(thread.id, 0);
      const approvals = await approvalGate.listApprovals();
  
      expect(approvals.approvals).toEqual([]);
      expect(toolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
      expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
    });
  
  it('runs unsandboxed exec without prompting under full access', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Full approval escalated exec loop' });
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
        configStore: new FullApprovalConfigStore('danger-full-access'),
      });
  
      await loop.sendTurn(thread.id, { input: 'run escalated command under full policy' });
      await expect(approvalGate.listApprovals()).resolves.toEqual({ approvals: [] });
      expect(toolHost.attempts).toEqual(['bypass']);
    });
  
  it('treats an empty additional-permissions override as the default sandbox under full policy', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Empty additional permissions exec loop' });
      const toolHost = new AdditionalPermissionsExecToolHost();
      const approvalGate = new InMemoryApprovalGate(systemClock, ids);
      const loop = new AgentLoop({
        threadStore,
        modelClient: new EmptyAdditionalPermissionsExecModelClient(),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        approvalGate,
        configStore: new FullApprovalConfigStore(),
      });
  
      await loop.sendTurn(thread.id, { input: 'run a command with an empty permission override' });
  
      await expect(approvalGate.listApprovals()).resolves.toEqual({ approvals: [] });
      expect(toolHost.contexts).toHaveLength(1);
      expect(toolHost.contexts[0]?.sandbox?.mode).toBe('default');
      const events = await threadStore.listEvents(thread.id, 0);
      expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
      expect(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.toolName === 'exec_command'
        && event.payload.status === 'success'
      )).toBe(true);
    });
});
