import { ResizeHandle } from '@setsuna-desktop/renderer-ui';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { DesktopPanelHeader } from './DesktopPanelHeader.js';
import type {
  DesktopPanelDropPlacement,
  DesktopPanelSlot,
  DesktopPanelTab,
  DesktopPanelType,
} from './model.js';

export function BottomToolsPanel({
  activePanel,
  availablePanelTypes,
  children,
  panels,
  unsavedFilePath,
  isFileDirty,
  onActivatePanel,
  onClosePanel,
  onHide,
  onMovePanel,
  onOpenPanel,
  onReorderPanels,
  onResizeStep,
  onResizeStart,
  resizeMax,
  resizeMin,
  resizeValue,
}: {
  activePanel: DesktopPanelTab;
  availablePanelTypes: DesktopPanelType[];
  children?: ReactNode;
  panels: DesktopPanelTab[];
  unsavedFilePath?: string | null;
  isFileDirty?: (path: string, rootId?: string) => boolean;
  onActivatePanel: (panelId: string) => void;
  onClosePanel: (panelId: string) => void;
  onHide: () => void;
  onMovePanel: (
    panelId: string,
    targetPlacement: DesktopPanelSlot,
    targetPanelId: string | null,
    placement: DesktopPanelDropPlacement,
  ) => void;
  onOpenPanel: (panel: DesktopPanelType) => void;
  onReorderPanels: (panelId: string, targetPanelId: string, placement: DesktopPanelDropPlacement) => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}) {
  const { t } = useI18n();

  return (
    <section className="bottom-panel" aria-label={t('workspace.bottom.tools')}>
      <ResizeHandle
        className="bottom-panel__resize-handle"
        type="button"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('workspace.bottom.resize')}
        aria-valuemin={resizeMin}
        aria-valuemax={resizeMax}
        aria-valuenow={resizeValue}
        title={t('workspace.bottom.resizeHint')}
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
        unsavedFilePath={unsavedFilePath}
        isFileDirty={isFileDirty}
        onClose={onHide}
        onClosePanel={onClosePanel}
        onMovePanel={onMovePanel}
        onOpenPanel={onOpenPanel}
        onReorderPanels={onReorderPanels}
        onSelectPanel={onActivatePanel}
      />
      <div className="bottom-panel__body" role="tabpanel">
        {children}
      </div>
    </section>
  );
}
