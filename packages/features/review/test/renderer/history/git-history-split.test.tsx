// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GitConflictHistory } from '../../../src/renderer/history/GitConflictHistory.js';
import { GitHistoryGraph } from '../../../src/renderer/history/GitHistoryGraph.js';
import { GitHistorySplit } from '../../../src/renderer/history/GitHistorySplit.js';
import { ReviewRendererTestHost } from '../review-renderer-test-host.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(withConflicts = true) {
  const noop = () => undefined;
  const view = render(<ReviewRendererTestHost>
    <section className="desktop-review-panel git-changes-panel">
      <nav className="git-changes-nav">
        <GitHistorySplit
          files={<div className="git-changes-files">Files</div>}
          conflicts={withConflicts ? <GitConflictHistory tasks={[{ threadId: 'repair', turnId: 'turn', createdAt: '2026-09-09T12:00:00Z', operation: 'pull' }]} selectedTurnId={null} onSelect={noop} /> : null}
          graph={<GitHistoryGraph workspaceRoot="/repo" commits={[]} refs={[]} head={null} selectedOid={null} loading={false} hasMore={false} error={null} onSelect={noop} onSelectRef={noop} onLoadMore={noop} onRetry={noop} />}
        />
      </nav>
    </section>
  </ReviewRendererTestHost>);
  // Rendered dimensions include a 1.25 UI scale. Each divider uses its own region.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return { height: this.classList.contains('git-history-split__graph') ? 300 : 1000 } as DOMRect;
  });
  const outer = screen.getByRole('separator', { name: '调整提交历史高度' });
  const inner = screen.queryByRole('separator', { name: '调整冲突与图形高度' });
  for (const handle of [outer, inner]) {
    if (!handle) continue;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
  }
  return { ...view, outer, inner };
}

it('resizes the graph independently from the whole history region, including zoom, pointer cancellation and keyboard bounds', () => {
  const { container, outer, inner } = setup();
  const handle = inner!;
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 500 });
  fireEvent.pointerMove(handle, { pointerId: 2, clientY: 425 });
  expect(handle.getAttribute('aria-valuenow')).toBe('50');
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 425 });
  expect(handle.getAttribute('aria-valuenow')).toBe('75');
  expect(container.querySelector<HTMLElement>('.git-history-split__commits')?.style.height).toBe('75%');
  expect(outer.getAttribute('aria-valuenow')).toBe('30');
  fireEvent.pointerCancel(handle, { pointerId: 1 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300 });
  expect(handle.getAttribute('aria-valuenow')).toBe('75');
  fireEvent.pointerDown(outer, { button: 0, pointerId: 3, clientY: 600 });
  fireEvent.pointerMove(outer, { pointerId: 3, clientY: 500 });
  fireEvent.pointerUp(outer, { pointerId: 3 });
  expect(outer.releasePointerCapture).toHaveBeenCalledWith(3);
  expect(container.querySelector<HTMLElement>('.git-history-split__graph')?.style.height).toBe('40%');
  expect(handle.getAttribute('aria-valuenow')).toBe('75');
  fireEvent.keyDown(handle, { key: 'ArrowDown' });
  expect(handle.getAttribute('aria-valuenow')).toBe('70');
  fireEvent.keyDown(handle, { key: 'End' });
  expect(handle.getAttribute('aria-valuenow')).toBe('80');
  fireEvent.keyDown(handle, { key: 'Home' });
  expect(handle.getAttribute('aria-valuenow')).toBe('20');
});

it('retains the original graph divider when there is no conflict history', () => {
  const { outer, inner } = setup(false);
  expect(inner).toBeNull();
  fireEvent.keyDown(outer, { key: 'ArrowUp' });
  expect(outer.getAttribute('aria-valuenow')).toBe('35');
});
