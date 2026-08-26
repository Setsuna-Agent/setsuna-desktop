// @vitest-environment happy-dom

import type {
  RuntimeActiveTask,
  RuntimeBackgroundServiceActivity,
} from '../../src/contracts/index.js';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RuntimeActiveTaskRows,
  RuntimeBackgroundServiceRows,
} from '../../src/renderer/RuntimeActivityRows.js';
import { runtimeTaskActivityKey } from '../../src/renderer/runtime-activity-model.js';
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
    const activeHtml = renderTaskRows(new Set());
    const stoppingHtml = renderTaskRows(new Set([runtimeTaskActivityKey(task)]));

    expect(activeHtml).toContain('aria-label="终止任务：整理运行中心"');
    expect(activeHtml).toContain('>终止<');
    expect(stoppingHtml).toContain('class="runtime-activity-row__action" disabled=""');
    expect(stoppingHtml).toContain('is-spinning');
  });

  it('does not offer an open action when a service source thread was deleted', () => {
    const html = renderToStaticMarkup(
      <RuntimeBackgroundServiceRows
        nowMs={Date.parse('2026-08-06T07:02:00.000Z')}
        onOpenThread={vi.fn()}
        onStopService={vi.fn()}
        projectNameById={new Map()}
        services={[orphanedService]}
        stoppingKeys={new Set()}
        translate={runtimeActivityTestTranslate}
      />,
    );

    expect(html).toContain('原对话已删除');
    expect(html).toContain('aria-label="终止服务：pnpm dev"');
  });

  it('keeps side tasks and services stoppable without opening them in the primary chat', () => {
    const onOpenThread = vi.fn();
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
    const { container } = render(
      <>
        <RuntimeActiveTaskRows
          nowMs={Date.parse('2026-08-06T07:02:00.000Z')}
          onOpenThread={onOpenThread}
          onStopTask={vi.fn()}
          projectNameById={new Map()}
          stoppingKeys={new Set()}
          tasks={[sideTask]}
          translate={runtimeActivityTestTranslate}
        />
        <RuntimeBackgroundServiceRows
          nowMs={Date.parse('2026-08-06T07:02:00.000Z')}
          onOpenThread={onOpenThread}
          onStopService={vi.fn()}
          projectNameById={new Map()}
          services={[sideService]}
          stoppingKeys={new Set()}
          translate={runtimeActivityTestTranslate}
        />
      </>,
    );

    const rows = container.querySelectorAll('.runtime-activity-row');
    expect(rows).toHaveLength(2);
    rows.forEach((row) => fireEvent.doubleClick(row));

    expect(onOpenThread).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.runtime-activity-row__action')).toHaveLength(2);
  });
});

function renderTaskRows(stoppingKeys: Set<string>): string {
  return renderToStaticMarkup(
    <RuntimeActiveTaskRows
      nowMs={Date.parse('2026-08-06T07:02:00.000Z')}
      onOpenThread={vi.fn()}
      onStopTask={vi.fn()}
      projectNameById={new Map()}
      stoppingKeys={stoppingKeys}
      tasks={[task]}
      translate={runtimeActivityTestTranslate}
    />,
  );
}
