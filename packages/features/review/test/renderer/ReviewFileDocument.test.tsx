// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState, type ComponentProps } from 'react';
import type { DesktopDiffFile, DesktopReviewBridge, DesktopReviewFocusRequest } from '../../src/contracts/index.js';
import { DesktopReviewPanel } from '../../src/renderer/ReviewPanel.js';
import { GitHistoryDiff } from '../../src/renderer/history/GitHistoryDiff.js';
import type { ReviewPathContext } from '../../src/renderer/review-types.js';
import { ReviewRendererTestHost } from './review-renderer-test-host.js';
import { ReviewFileViewControls, type ReviewFileViewMode } from '../../src/renderer/ReviewFileDocument.js';

afterEach(() => { cleanup(); window.localStorage.clear(); });

function HistoryPreview(props: Omit<ComponentProps<typeof GitHistoryDiff>, 'fileView'>) {
  const [mode, setMode] = useState<ReviewFileViewMode>('source');
  return <><ReviewFileViewControls mode={mode} onChange={setMode} /><GitHistoryDiff {...props} fileView={mode} /></>;
}

it.each(['latest', 'staged', 'commit'] as const)('switches Markdown and CSV documents in the %s panel together and keeps the selected version', async (source) => {
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
  const csv = { ...file, path: 'data/report.csv' };
  const files = [file, { ...file, path: 'docs/guide.md' }, { ...file, path: 'src/app.ts' }, csv];
  const actions = {
    workspaceApps: [],
    onOpenProjectFile, onAddFileToConversation: vi.fn(), onCopyFilePath: vi.fn(), onExternalOpenFile: vi.fn(),
    onOpenFileWithApp: vi.fn(), onRevealFile: vi.fn(),
  };
  const panel = (visibleFiles = files, focusRequest?: DesktopReviewFocusRequest) => <ReviewRendererTestHost bridge={bridge} locale="en-US">
    {source === 'latest' ? <DesktopReviewPanel {...actions} activeProject={{ id: 'project', name: 'Project', path: '/repo', createdAt: '', updatedAt: '' }}
      error={null} latestSummary={{ files: visibleFiles, additions: visibleFiles.length, deletions: 0 }} loading={false} reviewState={null}
      focusRequest={focusRequest} onRefresh={vi.fn()} onSelectBaseRef={vi.fn()} />
      : <HistoryPreview files={visibleFiles} details={null} pathContext={pathContext} selectionKey={visibleFiles.map((entry) => entry.path).join(',')}
        diffLayout="unified" lineWrap
        loading={false} error={null} actions={actions} onRetry={vi.fn()} />}
  </ReviewRendererTestHost>;
  const view = render(panel());
  expect(readTextFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true }));
  for (const entry of files.slice(0, 2)) {
    await waitFor(() => expect(screen.getByRole('region', { name: entry.path }).textContent).toContain('Unchanged text outside the diff.'));
    expect(readTextFile).toHaveBeenCalledWith('/repo', expect.objectContaining({ source, side: 'after', filePath: entry.path, revisions: pathContext.revisions }));
  }
  expect(readTextFile).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('region', { name: `After: ${csv.path}` })).toBeTruthy();
  if (source !== 'latest') expect(screen.getByRole('region', { name: `Before: ${csv.path}` })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true }));
    await screen.findByRole('region', { name: nextFile.path });
  }
});

it('uses the selected file for preview availability and loading in a large review', async () => {
  const readTextFile = vi.fn().mockResolvedValue({ ok: true, content: '# Full document' });
  const bridge = { readTextFile } as unknown as DesktopReviewBridge;
  const documentFile: DesktopDiffFile = {
    path: 'docs/README.md', action: 'Modified', additions: 1, deletions: 0, truncated: false,
    lines: [{ type: 'added', content: '# Changed heading', lineNumber: 1, newLine: 1 }],
  };
  const sourceFile = { ...documentFile, path: 'src/app.ts' };
  const files = [documentFile, sourceFile, ...Array.from({ length: 23 }, (_, index) => ({
    ...sourceFile, path: `src/file-${index}.ts`,
  }))];
  const summary = { files, additions: files.length, deletions: 0 };
  const panel = (focusRequest: DesktopReviewFocusRequest = { path: sourceFile.path, version: 1 }) => (
    <ReviewRendererTestHost bridge={bridge} locale="en-US">
      <DesktopReviewPanel activeProject={{ id: 'project', name: 'Project', path: '/repo', createdAt: '', updatedAt: '' }}
        error={null} latestSummary={summary} loading={false} reviewState={null} focusRequest={focusRequest}
        onExternalOpenFile={vi.fn()} onOpenProjectFile={vi.fn()} onRefresh={vi.fn()} onSelectBaseRef={vi.fn()} />
    </ReviewRendererTestHost>
  );
  const view = render(panel());
  expect(screen.queryByRole('button', { name: 'Preview', exact: true })).toBeNull();
  expect(readTextFile).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: documentFile.path, exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true }));
  await screen.findByRole('region', { name: documentFile.path });
  expect(readTextFile).toHaveBeenCalledWith('/repo', expect.objectContaining({
    filePath: documentFile.path, source: 'latest', side: 'after',
  }));

  fireEvent.click(screen.getByRole('button', { name: sourceFile.path, exact: true }));
  expect(screen.queryByRole('button', { name: /^(Preview|Source)$/u })).toBeNull();
  expect(screen.queryByRole('region', { name: documentFile.path })).toBeNull();
  expect(readTextFile).toHaveBeenCalledTimes(1);

  view.rerender(panel({ path: documentFile.path, version: 2 }));
  await screen.findByRole('region', { name: documentFile.path });
  expect(readTextFile).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true }));
  expect(screen.queryByRole('region', { name: documentFile.path })).toBeNull();
});
