// @vitest-environment happy-dom

import type {
  RuntimeActiveTask,
  RuntimeBackgroundServiceActivity,
} from '../../src/contracts/index.js';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RuntimeActiveTaskRows,
  RuntimeBackgroundServiceRows,
} from '../../src/renderer/RuntimeActivityRows.js';
import { runtimeServiceActivityKey, runtimeTaskActivityKey } from '../../src/renderer/runtime-activity-model.js';
import { runtimeActivityTestTranslate } from './support.js';

const task: RuntimeActiveTask = {
  archived: false,
  projectId: 'project_1',
  queuedInputCount: 0,
  startedAt: '2026-08-06T07:00:00.000Z',
  state: 'running',
  taskKind: 'regular',
  threadId: 'thread_1',
  threadKind: 'regular',
  threadTitle: '整理运行中心',
  turnId: 'turn_1',
  updatedAt: '2026-08-06T07:01:00.000Z',
};

const orphanedService: RuntimeBackgroundServiceActivity = {
  archived: false,
  command: 'pnpm dev',
  directory: '.',
  expiresAt: null,
  id: 'process_1',
  startedAt: '2026-08-06T07:00:00.000Z',
  threadId: 'thread_deleted',
  threadKind: 'regular',
  threadTitle: null,
  toolCallId: 'call_1',
  turnId: 'turn_1',
};

afterEach(cleanup);

describe('RuntimeActiveTaskRows', () => {
  it('exposes the task-specific stop action and disables it while stopping', () => {
    const onStopTask = vi.fn();
    const content = (stoppingKeys: Set<string>) => (
      <RuntimeActiveTaskRows
        nowMs={Date.parse('2026-08-06T07:02:00.000Z')}
        onOpenThread={vi.fn()}
        onStopTask={onStopTask}
        projectNameById={new Map()}
        stoppingKeys={stoppingKeys}
        tasks={[task]}
        translate={runtimeActivityTestTranslate}
      />
    );
    const view = render(content(new Set()));
    const stop = view.getByRole('button', { name: '终止任务：整理运行中心' });
    fireEvent.click(stop);
    expect(onStopTask).toHaveBeenCalledExactlyOnceWith(task, runtimeTaskActivityKey(task));

    view.rerender(content(new Set([runtimeTaskActivityKey(task)])));
    expect((stop as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(stop);
    expect(onStopTask).toHaveBeenCalledOnce();
  });

  it('does not offer an open action when a service source thread was deleted', () => {
    const onOpenThread = vi.fn();
    const onStopService = vi.fn();
    const content = (service: RuntimeBackgroundServiceActivity) => (
      <RuntimeBackgroundServiceRows
        nowMs={Date.parse('2026-08-06T07:02:00.000Z')}
        onOpenThread={onOpenThread}
        onStopService={onStopService}
        projectNameById={new Map()}
        services={[service]}
        stoppingKeys={new Set()}
        translate={runtimeActivityTestTranslate}
      />
    );
    const view = render(content(orphanedService));
    fireEvent.doubleClick(view.getByText('pnpm dev'));
    expect(onOpenThread).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: '终止服务：pnpm dev' }));
    expect(onStopService).toHaveBeenCalledExactlyOnceWith(orphanedService, runtimeServiceActivityKey(orphanedService));

    const ownedService = { ...orphanedService, threadTitle: 'Existing thread' };
    view.rerender(content(ownedService));
    fireEvent.doubleClick(view.getByText('pnpm dev'));
    expect(onOpenThread).toHaveBeenCalledExactlyOnceWith(ownedService.threadId);
  });

  it('keeps side tasks and services stoppable without opening them in the primary chat', () => {
    const onOpenThread = vi.fn();
    const onStopTask = vi.fn();
    const onStopService = vi.fn();
    const sideTask: RuntimeActiveTask = {
      ...task,
      threadId: 'thread_side_task',
      threadKind: 'side',
    };
    const sideService: RuntimeBackgroundServiceActivity = {
      ...orphanedService,
      id: 'process_side',
      threadId: 'thread_side_service',
      threadKind: 'side',
      threadTitle: '侧边服务',
    };
    const view = render(
      <>
        <RuntimeActiveTaskRows
          nowMs={Date.parse('2026-08-06T07:02:00.000Z')}
          onOpenThread={onOpenThread}
          onStopTask={onStopTask}
          projectNameById={new Map()}
          stoppingKeys={new Set()}
          tasks={[sideTask]}
          translate={runtimeActivityTestTranslate}
        />
        <RuntimeBackgroundServiceRows
          nowMs={Date.parse('2026-08-06T07:02:00.000Z')}
          onOpenThread={onOpenThread}
          onStopService={onStopService}
          projectNameById={new Map()}
          services={[sideService]}
          stoppingKeys={new Set()}
          translate={runtimeActivityTestTranslate}
        />
      </>,
    );

    fireEvent.doubleClick(view.getByText(sideTask.threadTitle));
    fireEvent.doubleClick(view.getByText(sideService.command));
    expect(onOpenThread).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: '终止任务：整理运行中心' }));
    fireEvent.click(view.getByRole('button', { name: '终止服务：pnpm dev' }));
    expect(onStopTask).toHaveBeenCalledExactlyOnceWith(sideTask, runtimeTaskActivityKey(sideTask));
    expect(onStopService).toHaveBeenCalledExactlyOnceWith(sideService, runtimeServiceActivityKey(sideService));
  });
});
