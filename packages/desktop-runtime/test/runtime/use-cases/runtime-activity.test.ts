import type {
  RuntimeApprovalRequest,
  RuntimeBackgroundShellProcess,
  RuntimeThreadSummary,
} from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { listRuntimeActivities } from '../../../src/runtime/use-cases/runtime-activity.js';

describe('runtime activity use case', () => {
  it('projects active turns and enriches persisted services with their owner', async () => {
    const summaries: RuntimeThreadSummary[] = [
      threadSummary('thread_active', 'Build release', true, 'project_1'),
      threadSummary('thread_service', 'Dev server', false),
    ];
    const service: RuntimeBackgroundShellProcess = {
      id: 'process_1',
      threadId: 'thread_service',
      turnId: 'turn_service',
      toolCallId: 'call_service',
      command: 'pnpm dev',
      directory: '.',
      startedAt: '2026-08-06T08:00:00.000Z',
      expiresAt: null,
    };
    const source = {
      agentLoop: {
        activeTurnId: vi.fn((threadId: string) => (
          threadId === 'thread_active' ? 'turn_active' : null
        )),
      },
      backgroundShellProcesses: {
        listAllBackgroundShellProcesses: vi.fn(async () => [service]),
      },
      approvalGate: {
        listApprovals: vi.fn(async () => ({ approvals: [] })),
      },
      threadStore: {
        getThread: vi.fn(() => {
          throw new Error('activity polling must not load full threads');
        }),
        getTurnActivity: vi.fn(async () => ({
          queuedInputCount: 1,
          startedAt: '2026-08-06T09:00:00.000Z',
          taskKind: 'goal' as const,
          updatedAt: '2026-08-06T09:02:00.000Z',
        })),
        listThreads: vi.fn(async () => summaries),
      },
    } as unknown as Parameters<typeof listRuntimeActivities>[0];

    const result = await listRuntimeActivities(source);

    expect(source.threadStore.listThreads).toHaveBeenCalledWith({ includeArchived: true });
    expect(source.threadStore.getTurnActivity).toHaveBeenCalledWith('thread_active', 'turn_active');
    expect(source.threadStore.getThread).not.toHaveBeenCalled();
    expect(result.tasks).toEqual([expect.objectContaining({
      archived: true,
      projectId: 'project_1',
      queuedInputCount: 1,
      startedAt: '2026-08-06T09:00:00.000Z',
      state: 'running',
      taskKind: 'goal',
      threadId: 'thread_active',
      threadTitle: 'Build release',
      turnId: 'turn_active',
    })]);
    expect(result.backgroundServices).toEqual([{
      ...service,
      archived: false,
      threadTitle: 'Dev server',
    }]);
    expect(Date.parse(result.capturedAt)).not.toBeNaN();
  });

  it('derives waiting states from bounded pending approval records', async () => {
    const summaries = [
      threadSummary('thread_approval', 'Approval task', false),
      threadSummary('thread_input', 'Input task', false),
      threadSummary('thread_running', 'Running task', false),
    ];
    const approvals: RuntimeApprovalRequest[] = [
      pendingApproval('approval_1', 'thread_approval', 'turn_approval'),
      pendingApproval('approval_2', 'thread_input', 'turn_input'),
      {
        ...pendingApproval('approval_3', 'thread_input', 'turn_input'),
        userInput: {
          message: 'Choose a target',
          requestedSchema: { type: 'object', properties: {} },
        },
      },
    ];
    const source = {
      agentLoop: {
        activeTurnId: vi.fn((threadId: string) => `turn_${threadId.replace('thread_', '')}`),
      },
      approvalGate: {
        listApprovals: vi.fn(async () => ({ approvals })),
      },
      backgroundShellProcesses: {
        listAllBackgroundShellProcesses: vi.fn(async () => []),
      },
      threadStore: {
        getTurnActivity: vi.fn(async () => null),
        listThreads: vi.fn(async () => summaries),
      },
    } as unknown as Parameters<typeof listRuntimeActivities>[0];

    const result = await listRuntimeActivities(source);

    expect(Object.fromEntries(result.tasks.map((task) => [task.threadId, task.state]))).toEqual({
      thread_approval: 'waiting_for_approval',
      thread_input: 'waiting_for_input',
      thread_running: 'running',
    });
  });
});

function threadSummary(
  id: string,
  title: string,
  archived: boolean,
  projectId?: string,
): RuntimeThreadSummary {
  return {
    id,
    title,
    ...(projectId ? { projectId } : {}),
    archived,
    createdAt: '2026-08-06T08:00:00.000Z',
    updatedAt: '2026-08-06T09:00:00.000Z',
    messageCount: 0,
    lastMessagePreview: '',
  };
}

function pendingApproval(
  id: string,
  threadId: string,
  turnId: string,
): RuntimeApprovalRequest {
  return {
    id,
    threadId,
    turnId,
    toolCallId: `call_${id}`,
    toolName: 'exec_command',
    reason: 'Needs approval',
    argumentsPreview: '{}',
    status: 'pending',
    createdAt: '2026-08-06T09:00:00.000Z',
  };
}
