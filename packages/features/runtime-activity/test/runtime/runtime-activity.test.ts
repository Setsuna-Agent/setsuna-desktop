import type {
  RuntimeApprovalRequest,
  RuntimeBackgroundShellProcess,
  RuntimeThreadSummary,
} from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import {
  runtimeActivityFeature,
  stopRuntimeActivityService,
  stopRuntimeActivityTask,
  type RuntimeActivityRuntimeHost,
} from '../../src/contracts/index.js';
import { runtimeActivityRuntimeFeature } from '../../src/runtime/feature.js';
import { projectRuntimeActivities } from '../../src/runtime/runtime-activity.js';

describe('runtime activity use case', () => {
  it('projects active turns and enriches persisted services with their owner', async () => {
    const summaries: RuntimeThreadSummary[] = [
      { ...threadSummary('thread_active', 'Build release', true, 'project_1'), kind: 'side' },
      { ...threadSummary('thread_service', 'Dev server', false), kind: 'side' },
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
      activeTurnId: vi.fn((threadId: string) => (
        threadId === 'thread_active' ? 'turn_active' : null
      )),
      getTurnActivity: vi.fn(async () => ({
        queuedInputCount: 1,
        startedAt: '2026-08-06T09:00:00.000Z',
        taskKind: 'goal' as const,
        updatedAt: '2026-08-06T09:02:00.000Z',
      })),
      listApprovals: vi.fn(async () => []),
      listBackgroundShellProcesses: vi.fn(async () => [service]),
      listThreads: vi.fn(async () => summaries),
      now: vi.fn(() => new Date('2026-08-06T09:03:00.000Z')),
    } as unknown as Parameters<typeof projectRuntimeActivities>[0];

    const result = await projectRuntimeActivities(source);

    expect(source.listThreads).toHaveBeenCalledOnce();
    expect(source.getTurnActivity).toHaveBeenCalledWith('thread_active', 'turn_active');
    expect(result.tasks).toEqual([expect.objectContaining({
      archived: true,
      projectId: 'project_1',
      queuedInputCount: 1,
      startedAt: '2026-08-06T09:00:00.000Z',
      state: 'running',
      taskKind: 'goal',
      threadId: 'thread_active',
      threadKind: 'side',
      threadTitle: 'Build release',
      turnId: 'turn_active',
    })]);
    expect(result.backgroundServices).toEqual([{
      ...service,
      archived: false,
      threadKind: 'side',
      threadTitle: 'Dev server',
    }]);
    expect(result.capturedAt).toBe('2026-08-06T09:03:00.000Z');
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
      activeTurnId: vi.fn((threadId: string) => `turn_${threadId.replace('thread_', '')}`),
      getTurnActivity: vi.fn(async () => null),
      listApprovals: vi.fn(async () => approvals),
      listBackgroundShellProcesses: vi.fn(async () => []),
      listThreads: vi.fn(async () => summaries),
      now: vi.fn(() => new Date('2026-08-06T09:03:00.000Z')),
    } as unknown as Parameters<typeof projectRuntimeActivities>[0];

    const result = await projectRuntimeActivities(source);

    expect(Object.fromEntries(result.tasks.map((task) => [task.threadId, task.state]))).toEqual({
      thread_approval: 'waiting_for_approval',
      thread_input: 'waiting_for_input',
      thread_running: 'running',
    });
  });

  it('registers Feature-owned stop operations against the narrow runtime host', async () => {
    const cancelTurn = vi.fn(async () => true);
    const terminateBackgroundShellProcess = vi.fn(async () => ({ terminated: true }));
    const host: RuntimeActivityRuntimeHost = {
      activeTurnId: () => null,
      cancelTurn,
      getTurnActivity: async () => null,
      listApprovals: async () => [],
      listBackgroundShellProcesses: async () => [],
      listThreads: async () => [],
      now: () => new Date('2026-08-06T09:03:00.000Z'),
      terminateBackgroundShellProcess,
    };
    const routes = new Map<string, (input: unknown) => unknown | PromiseLike<unknown>>();
    const scope = createFeatureScope({
      featureId: runtimeActivityFeature.id,
      process: 'runtime',
      scopeId: 'runtime-activity-feature-test',
    });

    await runtimeActivityRuntimeFeature.setup({
      dependencies: {
        host,
        routes: {
          register(_scope, operation, handler) {
            routes.set(operation.id, (input) => handler(input as never, {
              signal: new AbortController().signal,
            }));
            return Object.freeze({ dispose() {} });
          },
        },
      },
      health: { setCondition() {} },
      provide() {},
      scope: scope.scope,
    });

    await expect(routes.get(stopRuntimeActivityTask.id)?.({
      threadId: 'thread_1',
      turnId: 'turn_1',
    })).resolves.toEqual({ cancelled: true });
    await expect(routes.get(stopRuntimeActivityService.id)?.({
      processId: 'process_1',
      threadId: 'thread_1',
    })).resolves.toEqual({ terminated: true });
    expect(cancelTurn).toHaveBeenCalledWith('thread_1', 'turn_1');
    expect(terminateBackgroundShellProcess).toHaveBeenCalledWith('thread_1', 'process_1');

    await scope.finishDispose();
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
