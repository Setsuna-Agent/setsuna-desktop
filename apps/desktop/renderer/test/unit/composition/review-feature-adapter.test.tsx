// @vitest-environment happy-dom
import { workspaceTargetRootId, type DesktopRuntimeClient, type RuntimeReviewFinding, type WorkspaceProjectTarget } from '@setsuna-desktop/contracts';
import type { ReviewCodePatchViewProps } from '@setsuna-desktop/feature-review/renderer/host';
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppTextContextMenu } from '../../../src/app/layout/AppTextContextMenu.js';
import { ToastProvider } from '../../../src/app/providers/ToastProvider.js';
import { ReviewFeatureHostBoundary } from '../../../src/composition/review-feature-adapter.js';
import { ReviewFeaturePanel } from '../../../src/composition/review-feature-panel-adapter.js';
import { createDesktopRuntimeClient } from '../../../src/services/runtime-client/client.js';
import { I18nProvider } from '../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../src/shared/i18n/messages.js';
import { reviewRendererFeature } from '../../../../../../packages/features/review/src/renderer/feature.js';

vi.mock('../../../src/services/runtime-client/client.js', () => ({ createDesktopRuntimeClient: vi.fn() }));
vi.mock('../../../src/shared/code/PierreCode.js', () => ({
  CodePatchView: ({ lineAnnotations, patch }: ReviewCodePatchViewProps) => <div>
    <code>{patch}</code>
    {lineAnnotations?.map((annotation, index) => <div key={index}>{annotation.metadata}</div>)}
  </div>,
}));
afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

it('copies selected review code through the text menu and retains file actions without a selection', async () => {
  const copied = vi.fn();
  const executeTextEdit = vi.fn(async () => { copied(document.getSelection()?.toString()); return true; });
  vi.stubGlobal('setsunaDesktop', { desktop: { platform: 'darwin' }, windowControls: { executeTextEdit } });
  vi.mocked(createDesktopRuntimeClient).mockReturnValue({} as DesktopRuntimeClient);
  const copyFilePath = vi.fn();
  const view = render(<I18nProvider initialLocale="zh-CN" messageCatalog={composeRendererMessages(hostMessages, [{ module: reviewRendererFeature }])}><ToastProvider><ReviewFeatureHostBoundary>
    <AppTextContextMenu />
    <ReviewFeaturePanel
      activeProject={{ id: 'review-project', path: '/review', name: 'Review', createdAt: '', updatedAt: '' }}
      error={null} loading={false} reviewState={null}
      latestSummary={{ additions: 1, deletions: 0, files: [{
        path: 'sample.ts', action: 'Modified', additions: 1, deletions: 0, truncated: false,
        lines: [{ type: 'added', lineNumber: 49, newLine: 49, content: 'const reviewed = true;' }],
      }] }}
      onCopyFilePath={copyFilePath} onOpenProjectFile={vi.fn()} onExternalOpenFile={vi.fn()}
      onRefresh={vi.fn()} onSelectBaseRef={vi.fn()}
    />
  </ReviewFeatureHostBoundary></ToastProvider></I18nProvider>);
  const code = view.container.querySelector('code')!;
  const start = code.textContent!.indexOf('reviewed');
  const range = document.createRange();
  range.setStart(code.firstChild!, start);
  range.setEnd(code.firstChild!, start + 'reviewed'.length);
  document.getSelection()!.addRange(range);
  fireEvent.contextMenu(code);
  const copy = await view.findByRole('menuitem', { name: '复制' });
  expect(view.queryByRole('menuitem', { name: '剪切' })).toBeNull();
  expect(view.queryByRole('menuitem', { name: '粘贴' })).toBeNull();
  document.getSelection()!.removeAllRanges();
  fireEvent.click(copy);
  await waitFor(() => expect(executeTextEdit).toHaveBeenCalledExactlyOnceWith('copy'));
  expect(copied).toHaveBeenCalledExactlyOnceWith('reviewed');

  document.getSelection()!.removeAllRanges();
  fireEvent.contextMenu(code);
  fireEvent.click(await view.findByRole('menuitem', { name: '复制文件路径' }));
  expect(copyFilePath).toHaveBeenCalledExactlyOnceWith('sample.ts');
});

it.each([
  { anchored: true, secondary: false }, { anchored: false, secondary: false },
  { anchored: true, secondary: true }, { anchored: false, secondary: true },
])('validates and opens review finding links (anchored=$anchored, secondary=$secondary)', async ({ anchored, secondary }) => {
  const searchProjectEntries = vi.fn(async (target: WorkspaceProjectTarget) => ({
    workspaceRoot: workspaceTargetRootId(target) === 'secondary' ? '/secondary' : '/review', query: '', scanned: 1, truncated: false,
    entries: [{ name: 'README.md', path: 'README.md', parent: '', kind: 'file' as const }],
  }));
  vi.mocked(createDesktopRuntimeClient).mockReturnValue({ searchProjectEntries } as unknown as DesktopRuntimeClient);
  const finding: RuntimeReviewFinding = {
    path: 'README.md', startLine: 1, priority: 'P2', title: 'Check the example',
    body: 'See `README.md:12`, [readme](README.md#L7), and `missing.ts`.',
  };
  const open = vi.fn();
  const view = render(<I18nProvider initialLocale="zh-CN" messageCatalog={composeRendererMessages(hostMessages, [{ module: reviewRendererFeature }])}><ToastProvider><ReviewFeatureHostBoundary>
    <ReviewFeaturePanel
      activeProject={{ id: 'review-project', path: secondary ? '/secondary' : '/review', name: 'Review', createdAt: '', updatedAt: '',
        ...(secondary ? { roots: [{ id: 'primary', path: '/review' }, { id: 'secondary', path: '/secondary' }] } : {}),
      }}
      error={null} loading={false} reviewState={null}
      findings={[finding]} focusRequest={{ path: finding.path, line: 1, version: 1, finding }}
      latestSummary={{ additions: 1, deletions: 0, files: anchored ? [{
        path: 'README.md', action: 'Modified', additions: 1, deletions: 0, truncated: false,
        lines: [{ type: 'added', lineNumber: 1, newLine: 1, content: 'changed' }],
      }] : [] }}
      onOpenProjectFile={open} onExternalOpenFile={vi.fn()} onRefresh={vi.fn()} onSelectBaseRef={vi.fn()}
    />
  </ReviewFeatureHostBoundary></ToastProvider></I18nProvider>);
  await waitFor(() => expect(view.getAllByRole('link')).toHaveLength(2));
  expect(searchProjectEntries).toHaveBeenCalledExactlyOnceWith(secondary
    ? { projectId: 'review-project', rootId: 'secondary' } : 'review-project', '', '');
  expect(view.getByText('missing.ts').closest('a')).toBeNull();
  fireEvent.click(view.getByRole('link', { name: 'README.md:12' }));
  fireEvent.click(view.getByRole('link', { name: 'readme' }));
  expect(open.mock.calls).toEqual([['README.md', 12], ['README.md', 7]]);
});
