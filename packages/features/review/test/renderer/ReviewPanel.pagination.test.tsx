// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopDiffSummary } from '../../src/contracts/index.js';
import { DesktopReviewPanel } from '../../src/renderer/ReviewPanel.js';
import type { ReviewRendererHost } from '../../src/renderer/host.js';
import { ReviewRendererTestHost } from './review-renderer-test-host.js';

afterEach(() => { cleanup(); window.localStorage.clear(); });

it('loads only the selected historical file in a large non-Git Review and cancels it on navigation', () => {
  const load = vi.fn<ReviewRendererHost['loadFileChangePreview']>(() => new Promise(() => undefined));
  const summary: DesktopDiffSummary = { additions: 25, deletions: 0, files: Array.from({ length: 25 }, (_, index) => ({
    path: `src/file-${index}.ts`, action: 'Modified', additions: 1, deletions: 0, truncated: true, lines: [],
    changeReference: { threadId: 'old_thread', path: `/repo/src/file-${index}.ts`, toolCallIds: [`early_${index}`] },
  })) };
  const view = render(<ReviewRendererTestHost loadFileChangePreview={load}>
    <DesktopReviewPanel activeProject={{ id: 'project', name: 'Workspace', path: '/repo', createdAt: '', updatedAt: '' }}
      reviewState={null} latestSummary={summary} loading={false} error={null}
      onExternalOpenFile={() => undefined} onOpenProjectFile={() => undefined} onRefresh={() => undefined} onSelectBaseRef={() => undefined} />
  </ReviewRendererTestHost>);
  expect(load).toHaveBeenCalledTimes(1);
  expect(load.mock.calls[0][0]).toEqual(summary.files[0].changeReference);
  fireEvent.click(screen.getByRole('button', { name: 'src/file-1.ts' }));
  expect(load.mock.calls[0][1].aborted).toBe(true);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load.mock.calls[1][0]).toEqual(summary.files[1].changeReference);
  view.unmount();
  expect(load.mock.calls[1][1].aborted).toBe(true);
});
