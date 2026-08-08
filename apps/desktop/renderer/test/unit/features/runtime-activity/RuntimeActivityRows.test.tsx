import type {
  RuntimeActiveTask,
  RuntimeBackgroundServiceActivity,
} from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeActiveTaskRows,
  RuntimeBackgroundServiceRows,
} from '../../../../src/features/runtime-activity/RuntimeActivityRows.js';
import { runtimeTaskActivityKey } from '../../../../src/features/runtime-activity/runtimeActivityModel.js';

const task: RuntimeActiveTask = {
  archived: false,
  projectId: 'project_1',
  queuedInputCount: 0,
  startedAt: '2026-08-06T07:00:00.000Z',
  state: 'running',
  taskKind: 'regular',
  threadId: 'thread_1',
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
  threadTitle: null,
  toolCallId: 'call_1',
  turnId: 'turn_1',
};

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
      />,
    );

    expect(html).toContain('原对话已删除');
    expect(html).toContain('aria-label="终止服务：pnpm dev"');
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
    />,
  );
}
