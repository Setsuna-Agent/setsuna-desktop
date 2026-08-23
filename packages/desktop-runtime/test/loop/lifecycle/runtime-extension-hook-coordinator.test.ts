import type { RuntimeConfigState, RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeHookCoordinator } from '../../../src/loop/lifecycle/runtime-hook-coordinator.js';
import type { ExtensionRuntime } from '../../../src/ports/extension-runtime.js';

describe('runtime extension hook coordinator', () => {
  it('delivers session.start after plugins are enabled on a later turn', async () => {
    const dispatch = vi.fn<ExtensionRuntime['dispatch']>(async () => ({}));
    const coordinator = coordinatorWithExtensions(dispatch);
    const thread = runtimeThread();
    const signal = new AbortController().signal;

    await coordinator.runTurnStartHooks({
      prompt: 'first prompt',
      runtimeConfig: runtimeConfigWithPlugins(false),
      signal,
      thread,
      turnId: 'turn_1',
    });
    expect(dispatch.mock.calls.filter(([eventName]) => eventName === 'session.start')).toHaveLength(0);

    await coordinator.runTurnStartHooks({
      prompt: 'second prompt',
      runtimeConfig: runtimeConfigWithPlugins(true),
      signal,
      thread,
      turnId: 'turn_2',
    });

    const sessionCalls = dispatch.mock.calls.filter(([eventName]) => eventName === 'session.start');
    expect(sessionCalls).toHaveLength(1);
    expect(sessionCalls[0]).toEqual([
      'session.start',
      expect.objectContaining({
        threadId: 'thread_1',
        turnId: 'turn_2',
        payload: { source: 'startup' },
      }),
    ]);
  });

  it('dispatches compact.before only before compaction and honors a block', async () => {
    const dispatch = vi.fn<ExtensionRuntime['dispatch']>(async () => ({
      block: true,
      reason: 'keep the current context',
    }));
    const coordinator = coordinatorWithExtensions(dispatch);
    const thread = runtimeThread();

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

function coordinatorWithExtensions(dispatch: ExtensionRuntime['dispatch']): RuntimeHookCoordinator {
  return new RuntimeHookCoordinator({
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
}

function runtimeConfigWithPlugins(plugins: boolean): RuntimeConfigState {
  return {
    configPath: '/config.json',
    dataPath: '/data',
    storagePath: '/storage',
    providers: [],
    globalPrompt: '',
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
    features: { hooks: false, plugins },
  };
}

function runtimeThread(): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Extension hooks',
    projectId: 'project_1',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    lastSeq: 0,
  };
}
