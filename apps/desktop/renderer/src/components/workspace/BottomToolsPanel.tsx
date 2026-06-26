import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { DesktopPanelHeader } from './DesktopPanelHeader.js';
import { DesktopReviewPanel } from './ReviewPanel.js';
import { TerminalPane } from './TerminalPane.js';
import type { DesktopDiffSummary, DesktopPanelTab, DesktopPanelType, DesktopReviewState, DesktopTerminalSession } from './model.js';
import type { PointerEvent as ReactPointerEvent } from 'react';

export function BottomToolsPanel({
  activePanel,
  panels,
  activeProject,
  latestReviewSummary,
  reviewError,
  reviewLoading,
  reviewState,
  terminalSession,
  onActivatePanel,
  onClosePanel,
  onCloseSlot,
  onExternalOpenFile,
  onOpenProjectFile,
  onOpenReviewPanel,
  onOpenTerminalPanel,
  onReviewRefresh,
  onResizeStep,
  onResizeStart,
  resizeMax,
  resizeMin,
  resizeValue,
}: {
  activePanel: DesktopPanelTab;
  panels: DesktopPanelTab[];
  activeProject?: WorkspaceProject;
  latestReviewSummary: DesktopDiffSummary | null;
  reviewError: string | null;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  terminalSession: DesktopTerminalSession | null;
  onActivatePanel: (panelId: string) => void;
  onClosePanel: (panelId: string) => void;
  onCloseSlot: () => void;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenProjectFile: (filePath: string) => void;
  onOpenReviewPanel: () => void;
  onOpenTerminalPanel: () => void;
  onReviewRefresh: () => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}) {
  const availablePanelTypes: DesktopPanelType[] = [activeProject ? 'review' : null, 'terminal'].filter(Boolean) as DesktopPanelType[];
  const handleOpenPanel = (panel: DesktopPanelType) => {
    if (panel === 'review') {
      onOpenReviewPanel();
      return;
    }
    if (panel === 'terminal') onOpenTerminalPanel();
  };

  return (
    <section className="bottom-panel" aria-label="Runtime tools">
      <button
        className="bottom-panel__resize-handle"
        type="button"
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整终端高度"
        aria-valuemin={resizeMin}
        aria-valuemax={resizeMax}
        aria-valuenow={resizeValue}
        title="拖拽调整底部面板高度"
        onPointerDown={onResizeStart}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            onResizeStep(16);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            onResizeStep(-16);
          }
        }}
      />
      <DesktopPanelHeader
        activePanel={activePanel.type}
        activePanelId={activePanel.id}
        availablePanelTypes={availablePanelTypes}
        panels={panels}
        placement="bottom"
        onClose={onCloseSlot}
        onClosePanel={onClosePanel}
        onOpenPanel={handleOpenPanel}
        onSelectPanel={onActivatePanel}
      />
      {activePanel.type === 'terminal' ? (
        <div className="bottom-panel__body bottom-panel__body--terminal" role="tabpanel">
          <TerminalPane session={terminalSession} />
        </div>
      ) : (
        <div className="bottom-panel__body bottom-panel__body--review" role="tabpanel">
          <DesktopReviewPanel
            activeProject={activeProject}
            error={reviewError}
            latestSummary={latestReviewSummary}
            loading={reviewLoading}
            reviewState={reviewState}
            onExternalOpenFile={onExternalOpenFile}
            onOpenProjectFile={onOpenProjectFile}
            onRefresh={onReviewRefresh}
          />
        </div>
      )}
    </section>
  );
}
