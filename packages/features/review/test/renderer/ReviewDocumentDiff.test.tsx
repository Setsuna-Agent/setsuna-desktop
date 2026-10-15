// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react';
import type { DocumentPreviewProps } from '@setsuna-desktop/renderer-contracts/workspace';
import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopDiffFile } from '../../src/contracts/index.js';
import { ReviewDocumentDiff } from '../../src/renderer/ReviewDocumentDiff.js';

const bridge = vi.hoisted(() => ({ readDocumentFile: vi.fn() }));
vi.mock('../../src/renderer/host.js', () => ({
  useReviewRendererHost: () => ({ bridge, translate: (key: string) => key, ui: { DocumentPreview: PreviewConsumer } }),
}));

function PreviewConsumer({ load }: DocumentPreviewProps) {
  useEffect(() => { void load(); }, [load]);
  return null;
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const file: DesktopDiffFile = {
  path: 'docs/new.xlsx', previousPath: 'docs/old.xlsx', action: 'Renamed',
  additions: 0, deletions: 0, contentKind: 'binary', truncated: false, lines: [],
};
const context = { workspaceRoot: '/repo/docs', gitRoot: '/repo', source: 'staged' as const, baseRef: 'main' };

it('reads both versions of a renamed document using workspace-relative paths and refreshes changed bytes', async () => {
  bridge.readDocumentFile.mockResolvedValue({ ok: true, data: new Uint8Array() });
  const view = render(<ReviewDocumentDiff file={file} pathContext={context} />);
  await waitFor(() => expect(bridge.readDocumentFile).toHaveBeenCalledTimes(2));
  expect(bridge.readDocumentFile).toHaveBeenNthCalledWith(1, '/repo/docs', {
    filePath: 'old.xlsx', side: 'before', source: 'staged', baseRef: 'main', revisions: undefined,
  });
  expect(bridge.readDocumentFile).toHaveBeenNthCalledWith(2, '/repo/docs', {
    filePath: 'new.xlsx', side: 'after', source: 'staged', baseRef: 'main', revisions: undefined,
  });
  const revisions = { before: 'a'.repeat(40), after: 'b'.repeat(40) };
  view.rerender(<ReviewDocumentDiff file={{ ...file }} pathContext={{ ...context, source: 'commit', revisions }} />);
  await waitFor(() => expect(bridge.readDocumentFile).toHaveBeenCalledTimes(4));
  expect(bridge.readDocumentFile.mock.calls.slice(2).map((call) => call[1])).toEqual([
    { filePath: 'old.xlsx', side: 'before', source: 'commit', baseRef: 'main', revisions },
    { filePath: 'new.xlsx', side: 'after', source: 'commit', baseRef: 'main', revisions },
  ]);
});

it.each([
  ['Created', 'staged', ['after']],
  ['Deleted', 'staged', ['before']],
  ['Modified', 'latest', ['after']],
  ['Deleted', 'latest', []],
] as const)('requests only available sides for %s files in %s', async (action, source, sides) => {
  bridge.readDocumentFile.mockResolvedValue({ ok: true, data: new Uint8Array() });
  render(<ReviewDocumentDiff file={{ ...file, action, previousPath: undefined }} pathContext={{ ...context, source }} />);
  await waitFor(() => expect(bridge.readDocumentFile).toHaveBeenCalledTimes(sides.length));
  expect(bridge.readDocumentFile.mock.calls.map((call) => call[1].side)).toEqual(sides);
});
