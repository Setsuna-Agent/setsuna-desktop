import type {
  RuntimeBackgroundShellProcess,
  RuntimeThread,
  RuntimeThreadSummary,
} from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  listRuntimeActivities,
  runtimeActiveTaskState,
} from '../../../src/runtime/use-cases/runtime-activity.js';

describe('runtime activity use case', () => {
  it('projects active turns and enriches persisted services with their owner', async () => {
    const summaries: RuntimeThreadSummary[] = [
      threadSummary('thread_active', 'Build release', true, 'project_1'),
      threadSummary('thread_service', 'Dev server', false),
    ];
    const activeThread: RuntimeThread = {
      ...summaries[0],
      activeTurnId: 'turn_active',
      lastSeq: 2,
      messages: [],
      queuedTurnInputs: [
        { id: 'queued_1', input: 'continue', createdAt: '2026-08-06T09:01:00.000Z' },
      ],
      turns: [{
        id: 'turn_active',
        items: [],
        startedAt: '2026-08-06T09:00:00.000Z',
        status: 'in_progress',
        taskKind: 'goal',
      }],
    };
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
      threadStore: {
        getThread: vi.fn(async () => activeThread),
        listThreads: vi.fn(async () => summaries),
      },
    } as unknown as Parameters<typeof listRuntimeActivities>[0];

    const result = await listRuntimeActivities(source);

    expect(source.threadStore.listThreads).toHaveBeenCalledWith({ includeArchived: true });
    expect(source.threadStore.getThread).toHaveBeenCalledOnce();
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

  it('distinguishes approval gates from structured user input', () => {
    const approvalThread = threadWithPendingRun({ approvalStatus: 'pending' });
    const inputThread = threadWithPendingRun({
      approvalStatus: 'pending',
      userInput: {
        message: 'Choose a target',
        requestedSchema: { type: 'object', properties: {} },
      },
    });

    expect(runtimeActiveTaskState(approvalThread, 'turn_1')).toBe('waiting_for_approval');
    expect(runtimeActiveTaskState(inputThread, 'turn_1')).toBe('waiting_for_input');
    expect(runtimeActiveTaskState(inputThread, 'turn_other')).toBe('running');
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

function threadWithPendingRun(
  run: Pick<NonNullable<RuntimeThread['messages'][number]['toolRuns']>[number], 'approvalStatus' | 'userInput'>,
): RuntimeThread {
  return {
    ...threadSummary('thread_1', 'Pending task', false),
    activeTurnId: 'turn_1',
    lastSeq: 1,
    messages: [{
      id: 'message_1',
      role: 'assistant',
      turnId: 'turn_1',
      content: '',
      createdAt: '2026-08-06T09:00:00.000Z',
      toolRuns: [{
        id: 'call_1',
        name: 'request_user_input',
        status: 'pending_approval',
        ...run,
      }],
    }],
  };
}
