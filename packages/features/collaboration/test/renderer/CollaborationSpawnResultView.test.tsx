// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CollaborationRendererStateController,
  CollaborationRendererStateService,
  CollaborationSpawnResult,
  CollaborationTask,
} from '../../src/contracts/index.js';
import { CollaborationSpawnResultView } from '../../src/renderer/CollaborationSpawnResultView.js';
import {
  CollaborationRendererProvider,
  CollaborationTaskNavigationProvider,
} from '../../src/renderer/context.js';

afterEach(cleanup);

describe('CollaborationSpawnResultView', () => {
  it('keeps a forked historical card detached from the source parent ledger', () => {
    const task = collaborationTask();
    const snapshot = Object.freeze({
      state: Object.freeze({ tasks: Object.freeze([task]) }),
      throughSeq: 12,
      error: null,
      loading: false,
      stale: false,
    });
    const controller: CollaborationRendererStateController = {
      snapshot: () => snapshot,
      start: vi.fn(),
      retry: vi.fn(),
      subscribe: (listener) => {
        listener(snapshot);
        return () => undefined;
      },
    };
    const controllerForThread = vi.fn(() => controller);
    const service: CollaborationRendererStateService = {
      available: true,
      controller: controllerForThread,
    };
    const openTask = vi.fn();
    const view = render(
      <CollaborationRendererProvider service={service}>
        <CollaborationTaskNavigationProvider onOpenTask={openTask}>
          <CollaborationSpawnResultView
            payload={spawnResult()}
            threadId="thread_fork"
            translate={(key) => key}
          />
        </CollaborationTaskNavigationProvider>
      </CollaborationRendererProvider>,
    );

    const card = view.getByRole('button') as HTMLButtonElement;
    expect(controllerForThread).not.toHaveBeenCalled();
    expect(card.disabled).toBe(true);
    expect(card.classList.contains('subagent-task-card--historical')).toBe(true);
    expect(card.title).toBe('feature.collaboration.card.historicalTitle');

    fireEvent.click(card);
    expect(openTask).not.toHaveBeenCalled();
  });
});

function spawnResult(): CollaborationSpawnResult {
  return {
    childThreadId: 'thread_child',
    identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
    objective: 'Inspect the repository.',
    parentThreadId: 'thread_parent',
    status: 'running',
    taskId: 'task_1',
    title: 'Repository scan',
    turnId: 'turn_child',
  };
}

function collaborationTask(): CollaborationTask {
  return {
    childThreadId: 'thread_child',
    createdAt: '2026-08-22T00:00:00.000Z',
    id: 'task_1',
    identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
    objective: 'Inspect the repository.',
    status: 'running',
    title: 'Repository scan',
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
}
