// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DesktopGitHistoryPage } from '@setsuna-desktop/feature-review/contracts';
import { appReadySlot, shellRouteSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import { useRef, type ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/app/providers/ToastProvider.js';
import { activateBuiltinRendererFeatures } from '../../../src/composition/renderer-feature-composition.js';
import { ReviewFeatureHostBoundary } from '../../../src/composition/review-feature-adapter.js';
import { useDesktopPanelResize } from '../../../src/features/workspace/hooks/useDesktopPanelResize.js';
import { createChangesPanel } from '../../../src/features/workspace/model.js';
import { WorkspacePanel } from '../../../src/features/workspace/WorkspacePanel.js';
import {
  RendererKernelProvider,
  RendererOwnedKeyedSlot,
  RendererRootSingleSlot,
} from '../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { I18nProvider, useI18n } from '../../../src/shared/i18n/I18nProvider.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
});

it('mounts Changes through the built-in shell and chat slots, including working resize controls', async () => {
  const oid = 'a'.repeat(40);
  const history: DesktopGitHistoryPage = {
    gitRoot: '/repo', head: oid, tip: oid, currentBranch: 'main', nextSkip: null,
    refs: [{ name: 'refs/heads/main', label: 'main', kind: 'local', oid }],
    commits: [{ oid, parents: [], subject: 'Initial project', author: 'Author', authoredAt: '2026-09-09T10:00:00Z' }],
  };
  const getHistory = vi.fn().mockResolvedValue(history);
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: {
      desktop: { platform: 'darwin' },
      desktopReview: { getHistory },
      links: { openExternal: vi.fn() },
      runtime: {
        request: vi.fn().mockResolvedValue({ ok: true, value: { plugins: [] } }),
        startSse: vi.fn(() => vi.fn()),
      },
    },
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1920);
  const features = await activateBuiltinRendererFeatures();
  try {
    const view = render(
      <I18nProvider initialLocale="zh-CN" messageCatalog={features.messages}>
        <ToastProvider>
          <ReviewFeatureHostBoundary>
            <RendererKernelProvider runtime={features.rendererPlugins}>
              <RendererRootSingleSlot slot={appReadySlot} props={{
                renderDefault: () => <RendererOwnedKeyedSlot slot={shellRouteSlot} entryKey="chat" props={{
                  routeId: 'chat', renderDefault: () => <ChangesWorkspace />,
                }} />,
              }} />
            </RendererKernelProvider>
          </ReviewFeatureHostBoundary>
        </ToastProvider>
      </I18nProvider>,
    );

    expect(await screen.findByRole('navigation', { name: '变更' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Initial project/ })).toBeTruthy();
    expect(getHistory).toHaveBeenCalledWith('/repo', { ref: undefined });
    const handle = screen.getByRole('separator', { name: '调整右侧面板宽度' });
    const shell = view.container.querySelector<HTMLElement>('.app-shell')!;
    expect(handle.getAttribute('aria-valuenow')).toBe('640');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1200 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 1100 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 1100 });
    expect(handle.getAttribute('aria-valuenow')).toBe('740');
    expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('740px');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('724');
    expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('724px');
  } finally {
    cleanup();
    await features.composition.dispose();
  }
});

function ChangesWorkspace() {
  const shellRef = useRef<HTMLDivElement>(null);
  const resize = useDesktopPanelResize(shellRef);
  const { t } = useI18n();
  return (
    <div className="app-shell" ref={shellRef}>
      <RendererOwnedKeyedSlot slot={workspacePanelSlot} entryKey="changes" instanceKey="workspace:side:changes" props={{
        panelId: 'changes', panelType: 'changes', placement: 'side', projectId: 'project_1',
        surfaceInstanceId: 'workspace:side:changes', threadId: 'thread_1', translate: t, visible: true,
        renderDefault: () => <WorkspacePanel
          {...panelProps}
          onResizeStart={resize.handleWorkspaceResizeStart}
          onResizeStep={resize.handleWorkspaceResizeStep}
          resizeMin={resize.workspaceMinWidth}
          resizeMax={resize.workspaceMaxWidth}
          resizeValue={resize.workspaceWidth}
        />,
      }} />
    </div>
  );
}

const noop = () => undefined;
const panelProps = {
  activePanel: createChangesPanel(),
  activeProject: { id: 'project_1', name: 'Fixture', path: '/repo', createdAt: '', updatedAt: '' },
  fileDraft: {
    canEdit: false, cancelEditing: noop, confirmDiscardChanges: () => true, content: '',
    dirty: false, editing: false, error: null, errorMessage: null, preparing: false,
    save: async () => false, saving: false, startEditing: async () => undefined, updateContent: noop,
  },
  fileFocusRequest: null, filePreview: null, latestReviewSummary: null, latestReviewFindings: [],
  reviewError: null, reviewFocusRequest: null, reviewLoading: false, reviewState: null,
  selectedWorkspaceApp: null, workspaceApps: [],
  onAddFileToConversation: noop, onCopyFilePath: noop, onExternalOpenFile: noop, onOpenFileWithApp: noop,
  onSearchProjectEntries: vi.fn(), onOpenEntry: noop, onOpenProjectFile: noop, onOpenFilesPanel: noop,
  onOpenBrowser: noop, onOpenSideChat: noop, onOpenTerminalPanel: noop, onReviewRefresh: noop,
  onReviewBaseRefChange: noop, onReviewSourceChange: noop, onRevealFile: noop,
} satisfies Omit<ComponentProps<typeof WorkspacePanel>, 'onResizeStart' | 'onResizeStep' | 'resizeMin' | 'resizeMax' | 'resizeValue'>;
