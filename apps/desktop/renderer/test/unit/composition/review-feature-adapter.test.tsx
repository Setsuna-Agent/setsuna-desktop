// @vitest-environment happy-dom
import type { DesktopRuntimeClient, RuntimeReviewFinding } from '@setsuna-desktop/contracts';
import type { ReviewCodePatchViewProps } from '@setsuna-desktop/feature-review/renderer/host';
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/app/providers/ToastProvider.js';
import { ReviewFeatureHostBoundary } from '../../../src/composition/review-feature-adapter.js';
import { ReviewFeaturePanel } from '../../../src/composition/review-feature-panel-adapter.js';
import { createDesktopRuntimeClient } from '../../../src/services/runtime-client/client.js';
import { I18nProvider } from '../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../src/shared/i18n/messages.js';
import { reviewRendererFeature } from '../../../../../../packages/features/review/src/renderer/feature.js';

vi.mock('../../../src/services/runtime-client/client.js', () => ({ createDesktopRuntimeClient: vi.fn() }));
vi.mock('../../../src/shared/code/PierreCode.js', () => ({
  CodePatchView: ({ lineAnnotations }: ReviewCodePatchViewProps) => <div>
    {lineAnnotations?.map((annotation, index) => <div key={index}>{annotation.metadata}</div>)}
  </div>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear(); });

it.each([true, false])('validates and opens review finding links in the reviewed project (anchored=%s)', async (anchored) => {
  const searchProjectEntries = vi.fn(async () => ({
    workspaceRoot: '/review', query: '', scanned: 1, truncated: false,
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
      activeProject={{ id: 'review-project', path: '/review', name: 'Review', createdAt: '', updatedAt: '' }}
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
  expect(searchProjectEntries).toHaveBeenCalledExactlyOnceWith('review-project', '', '');
  expect(view.getByText('missing.ts').closest('a')).toBeNull();
  fireEvent.click(view.getByRole('link', { name: 'README.md:12' }));
  fireEvent.click(view.getByRole('link', { name: 'readme' }));
  expect(open.mock.calls).toEqual([['README.md', 12], ['README.md', 7]]);
});
