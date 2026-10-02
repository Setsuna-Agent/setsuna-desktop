import { describe, expect, it, vi } from 'vitest';
import { ComputerRuntimeTools } from '../../../../features/computer-use/src/runtime/tools.js';
import { ComputerToolHost } from '../../../src/adapters/tool/computer-tool-host.js';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import { ToolApprovalStore, ToolOrchestrator } from '../../../src/loop/tools/tool-orchestrator.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { RuntimeToolExecutionContext } from '../../../src/ports/tool-host.js';

function fixture(decision: 'approve_for_session' | 'reject' = 'reject') {
  let id = 0;
  const gate = new InMemoryApprovalGate(systemClock, { id: (prefix) => `${prefix}_${++id}` });
  const execute = vi.fn(async () => ({ kind: 'stopped' as const }));
  const host = new ComputerToolHost();
  host.bind(new ComputerRuntimeTools({ execute, isEnabled: async () => true }));
  const requested = vi.fn(async (approval) => { await gate.answerApproval(approval.id, { decision }); });
  const orchestrator = new ToolOrchestrator({
    toolHost: host, approvalGate: gate, approvalStore: new ToolApprovalStore(), clock: systemClock,
    events: {
      publishToolStarted: async () => undefined, publishToolCompleted: async () => undefined,
      publishToolOutputDelta: async () => undefined, publishHookStarted: async () => undefined,
      publishHookCompleted: async () => undefined, publishApprovalRequested: requested,
      publishApprovalResolved: async () => undefined,
    },
  });
  const context: RuntimeToolExecutionContext = {
    threadId: 'thread', turnId: 'turn', modelCapabilities: { supportsImages: true },
    environment: { id: 'local', cwd: '/workspace', workspaceRoot: '/workspace', workspaceRoots: ['/workspace'] },
    permissionProfile: 'danger-full-access', sandboxWorkspaceWrite: undefined, signal: new AbortController().signal,
  };
  const run = (policy: 'full' | 'on-request' | 'strict', name = 'computer_start', current = context) =>
    orchestrator.runToolCall({ id: `call_${++id}`, name, arguments: '{}' }, {}, current, policy);
  return { run, execute, requested, context };
}

describe('computer tools use the shared approval policy', () => {
  it('runs full-access scheduled turns without a second consent flow', async () => {
    const f = fixture();
    expect(await f.run('full', 'computer_start', { ...f.context, unattended: true })).toMatchObject({ status: 'success' });
    expect(f.requested).not.toHaveBeenCalled();
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'start', identity: expect.objectContaining({ unattended: true }) }), expect.any(AbortSignal));
  });
  it('honors a normal approval rejection before sending anything to desktop main', async () => {
    const f = fixture();
    expect(await f.run('on-request')).toMatchObject({ status: 'rejected' });
    expect(f.requested).toHaveBeenCalledOnce();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('reuses session approval across turns, isolates other threads, and never prompts to stop', async () => {
    const f = fixture('approve_for_session');
    expect(await f.run('on-request')).toMatchObject({ status: 'success' });
    expect(await f.run('on-request', 'computer_start', { ...f.context, turnId: 'next' })).toMatchObject({ status: 'success' });
    expect(f.requested).toHaveBeenCalledOnce();
    expect(await f.run('on-request', 'computer_start', { ...f.context, threadId: 'another' })).toMatchObject({ status: 'success' });
    expect(f.requested).toHaveBeenCalledTimes(2);
    expect(await f.run('strict', 'computer_stop')).toMatchObject({ status: 'success' });
    expect(f.requested).toHaveBeenCalledTimes(2);
  });
});
