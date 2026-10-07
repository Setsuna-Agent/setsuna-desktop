// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopDiffFile, DesktopReviewBridge, DesktopReviewFocusRequest } from '../../src/contracts/index.js';
import { DesktopReviewPanel } from '../../src/renderer/ReviewPanel.js';
import { GitHistoryDiff } from '../../src/renderer/history/GitHistoryDiff.js';
import type { ReviewPathContext } from '../../src/renderer/review-types.js';
import { ReviewRendererTestHost } from './review-renderer-test-host.js';

afterEach(() => { cleanup(); window.localStorage.clear(); });

it.each(['latest', 'staged', 'commit'] as const)('switches every Markdown document in the %s panel together and keeps the selected version', async (source) => {
  const readTextFile = vi.fn().mockImplementation(async (_root, input) => ({ ok: true, content: `# ${input.filePath}\n\nUnchanged text outside the diff.` }));
  const bridge = { readTextFile } as unknown as DesktopReviewBridge;
  const onOpenProjectFile = vi.fn();
  const file: DesktopDiffFile = {
    path: 'docs/README.md', action: 'Modified', additions: 1, deletions: 0, truncated: true,
    lines: [{ type: 'added', content: '# Changed heading', lineNumber: 1, newLine: 1 }],
  };
  const pathContext: ReviewPathContext = {
    source, workspaceRoot: '/repo', gitRoot: '/repo',
    ...(source === 'commit' ? { revisions: { before: 'a'.repeat(40), after: 'b'.repeat(40) } } : {}),
  };
  const files = [file, { ...file, path: 'docs/guide.md' }, { ...file, path: 'src/app.ts' }];
  const actions = {
    workspaceApps: [],
    onOpenProjectFile, onAddFileToConversation: vi.fn(), onCopyFilePath: vi.fn(), onExternalOpenFile: vi.fn(),
    onOpenFileWithApp: vi.fn(), onRevealFile: vi.fn(),
  };
  const panel = (visibleFiles = files, focusRequest?: DesktopReviewFocusRequest) => <ReviewRendererTestHost bridge={bridge} locale="en-US">
    {source === 'latest' ? <DesktopReviewPanel {...actions} activeProject={{ id: 'project', name: 'Project', path: '/repo', createdAt: '', updatedAt: '' }}
      error={null} latestSummary={{ files: visibleFiles, additions: visibleFiles.length, deletions: 0 }} loading={false} reviewState={null}
      focusRequest={focusRequest} onRefresh={vi.fn()} onSelectBaseRef={vi.fn()} />
      : <GitHistoryDiff files={visibleFiles} details={null} pathContext={pathContext} selectionKey={visibleFiles.map((entry) => entry.path).join(',')}
        loading={false} error={null} actions={actions} onRetry={vi.fn()} onBack={vi.fn()} />}
  </ReviewRendererTestHost>;
  const view = render(panel());
  expect(readTextFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true }));
  for (const entry of files.slice(0, 2)) {
    await waitFor(() => expect(screen.getByRole('region', { name: entry.path }).textContent).toContain('Unchanged text outside the diff.'));
    expect(readTextFile).toHaveBeenCalledWith('/repo', expect.objectContaining({ source, side: 'after', filePath: entry.path, revisions: pathContext.revisions }));
  }
  expect(readTextFile).toHaveBeenCalledTimes(2);
  // Changing the selected file/summary must inherit the panel mode, including single-file changes.
  const nextFile = { ...file, path: 'docs/next.md' };
  view.rerender(panel([nextFile]));
  await screen.findByRole('region', { name: nextFile.path });
  fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true }));
  expect(screen.queryByRole('region', { name: nextFile.path })).toBeNull();
  expect(readTextFile).toHaveBeenCalledTimes(3);
  expect(onOpenProjectFile).not.toHaveBeenCalled();
  if (source === 'latest') {
    fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true }));
    await screen.findByRole('region', { name: nextFile.path });
    view.rerender(panel([nextFile], { path: nextFile.path, line: 1, version: 1 }));
    await waitFor(() => expect(screen.queryByRole('region', { name: nextFile.path })).toBeNull());
    expect(screen.getByRole('button', { name: 'Source', exact: true }).getAttribute('aria-pressed')).toBe('true');
  }
});
