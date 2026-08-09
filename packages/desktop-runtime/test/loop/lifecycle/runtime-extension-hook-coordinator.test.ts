import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeHookCoordinator } from '../../../src/loop/lifecycle/runtime-hook-coordinator.js';

describe('runtime extension hook coordinator', () => {
  it('dispatches compact.before only before compaction and honors a block', async () => {
    const dispatch = vi.fn(async () => ({ block: true, reason: 'keep the current context' }));
    const coordinator = new RuntimeHookCoordinator({
      clock: { now: () => new Date('2026-08-09T00:00:00.000Z') },
      environmentResolver: {
        resolve: async () => ({
          id: 'local',
          cwd: '/workspace',
          workspaceRoot: '/workspace',
          workspaceRoots: ['/workspace'],
        }),
      },
      ids: { id: (prefix) => `${prefix}_1` },
      toolExecutor: {
        publishHookStarted: vi.fn(async () => undefined),
        publishHookCompleted: vi.fn(async () => undefined),
      },
      extensions: { dispatch },
    });
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Compact extension',
      projectId: 'project_1',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      messages: [],
      lastSeq: 0,
    };

    await expect(coordinator.runCompactHooks({
      eventName: 'PreCompact',
      runtimeConfig: null,
      thread,
      trigger: 'manual',
      turnId: 'turn_1',
    })).resolves.toEqual({ shouldStop: true, stopReason: 'keep the current context' });
    await expect(coordinator.runCompactHooks({
      eventName: 'PostCompact',
      runtimeConfig: null,
      thread,
      trigger: 'manual',
      turnId: 'turn_1',
    })).resolves.toEqual({ shouldStop: false });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith('compact.before', expect.objectContaining({
      threadId: 'thread_1',
      turnId: 'turn_1',
      projectId: 'project_1',
      cwd: '/workspace',
      payload: { trigger: 'manual' },
    }));
  });
});
