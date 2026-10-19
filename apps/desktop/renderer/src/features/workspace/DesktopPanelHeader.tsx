import { Button, Tooltip, useReorderLayout, animateReorderLayout, reorderItemRect } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ShortcutTooltip, ShortcutTooltipContent } from '../../shared/ui/ShortcutTooltip.js';
import { usePanelTabCloseTransition } from './hooks/usePanelTabCloseTransition.js';
import { usePanelTabScroll } from './hooks/usePanelTabScroll.js';
import { DesktopPanelIcon, desktopPanelTitle } from './PanelChrome.js';
import { PanelPlacementIcon } from './PanelPlacementIcon.js';
import {
  canMoveDesktopPanelAcrossSlots,
  type DesktopPanelDropPlacement,
  type DesktopPanelTab,
  type DesktopPanelType,
} from './model.js';

export type DesktopPanelPlacement = 'side' | 'bottom';

type PanelPointerDrag = {
  active: boolean;
  clientX: number;
  clientY: number;
  crossSlotPlaceholder: HTMLSpanElement | null;
  crossSlotEnabled: boolean;
  crossSlotTarget: string | null;
  height: number;
  lastReorderTarget: string | null;
  offsetX: number;
  offsetY: number;
  panel: DesktopPanelTab;
  pointerId: number;
  previewFrame: number | null;
  previewLeft: number;
  previewTop: number;
  scaleInverse: number;
  sourceElement: HTMLSpanElement;
  startX: number;
  startY: number;
  width: number;
};

type PanelDragOverlay = {
  height: number;
  left: number;
  panel: DesktopPanelTab;
  top: number;
  width: number;
};

type PanelCrossSlotDropTarget = {
  panelId: string | null;
  placement: DesktopPanelPlacement;
  position: DesktopPanelDropPlacement;
};

const PANEL_DRAG_START_DISTANCE = 4;
const PANEL_TAB_EXIT_ANIMATION_NAME = 'desktop-panel-tab-exit';

export function DesktopPanelHeader({
  actions,
  activePanel,
  activePanelId,
  bottomBarActive = false,
  onClose,
  onClosePanel,
  onMovePanel,
  onAddPanel,
  onReorderPanels,
  onSelectPanel,
  onToggleBottomTerminal,
  panels,
  placement,
  unsavedFilePath,
  isFileDirty,
}: {
  actions?: ReactNode;
  activePanel: DesktopPanelType;
  activePanelId?: string | null;
  bottomBarActive?: boolean;
  onClose: () => void;
  onClosePanel?: (panelId: string) => void;
  onMovePanel?: (
    panelId: string,
    targetPlacement: DesktopPanelPlacement,
    targetPanelId: string | null,
    position: DesktopPanelDropPlacement,
  ) => void;
  onAddPanel?: () => void;
  onReorderPanels?: (panelId: string, targetPanelId: string, placement: DesktopPanelDropPlacement) => void;
  onSelectPanel?: (panelId: string) => void;
  onToggleBottomTerminal?: () => void;
  panels?: DesktopPanelTab[];
  placement: DesktopPanelPlacement;
  unsavedFilePath?: string | null;
  isFileDirty?: (path: string, rootId?: string) => boolean;
}) {
  const { t } = useI18n();
  const [dragOverlay, setDragOverlay] = useState<PanelDragOverlay | null>(null);
  const pointerDragRef = useRef<PanelPointerDrag | null>(null);
  const dragPreviewRef = useRef<HTMLSpanElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const suppressNextClickRef = useRef(false);
  const tabsRef = useRef<HTMLSpanElement | null>(null);
  const tabsId = useId();
  const {
    closingPanelWidths,
    finishPanelClose,
    startPanelClose,
  } = usePanelTabCloseTransition(onClosePanel);
  const activeId = activePanelId || activePanel;
  const tabPanels = panels?.length ? panels : [{ id: activeId, type: activePanel }];
  const tabOrderKey = JSON.stringify(tabPanels.map((panel) => panel.id));
  useReorderLayout(tabsRef, tabOrderKey, Boolean(dragOverlay));
  const { canScrollLeft, canScrollRight, scrollTabs } = usePanelTabScroll(tabsRef, activeId, tabOrderKey, Boolean(dragOverlay));
  const addPanelLabel = t(placement === 'side' ? 'workspace.panel.openOverview' : 'workspace.panel.newTerminal');
  const sortable = Boolean(onReorderPanels && tabPanels.length > 1);
  const canDragPanel = (panel: DesktopPanelTab) =>
    sortable || Boolean(onMovePanel && canMoveDesktopPanelAcrossSlots(panel, tabPanels));
  const draggedPanelId = dragOverlay?.panel.id ?? null;

  const suppressFollowingClick = () => {
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
  };

  const clearDragState = (suppressClick: boolean) => {
    const drag = pointerDragRef.current;
    if (drag?.previewFrame !== null && drag?.previewFrame !== undefined) {
      window.cancelAnimationFrame(drag.previewFrame);
    }
    if (drag) clearPanelCrossSlotPlaceholder(drag);
    pointerDragRef.current = null;
    setDragOverlay(null);
    if (suppressClick) suppressFollowingClick();
  };

  const nextReorderTarget = (clientX: number, panelId: string) => {
    const tabElements = Array.from(tabsRef.current?.querySelectorAll<HTMLElement>('[data-desktop-panel-tab-id]') ?? [])
      .map((element) => {
        const targetPanelId = element.dataset.desktopPanelTabId;
        if (!targetPanelId || targetPanelId === panelId) return null;
        const rect = reorderItemRect(element);
        return {
          centerX: rect.left + rect.width / 2,
          panelId: targetPanelId,
        };
      })
      .filter(Boolean) as Array<{ centerX: number; panelId: string }>;
    if (!tabElements.length) return null;

    const nearest = tabElements.reduce((closest, item) =>
      Math.abs(clientX - item.centerX) < Math.abs(clientX - closest.centerX) ? item : closest,
    );
    return {
      panelId: nearest.panelId,
      placement: clientX < nearest.centerX ? 'before' : 'after',
    } satisfies { panelId: string; placement: DesktopPanelDropPlacement };
  };

  const sameSlotReorderTarget = (clientX: number, clientY: number, panelId: string) => {
    const headerRect = headerRef.current?.getBoundingClientRect();
    return headerRect && pointInsideRect(clientX, clientY, headerRect)
      ? nextReorderTarget(clientX, panelId)
      : null;
  };

  const updateSameSlotReorderPreview = (drag: PanelPointerDrag) => {
    const target = sameSlotReorderTarget(drag.clientX, drag.clientY, drag.panel.id);
    const targetKey = target ? panelReorderTargetKey(target.panelId, target.placement) : null;
    if (targetKey === drag.lastReorderTarget) return;
    drag.lastReorderTarget = targetKey;
    if (target) onReorderPanels?.(drag.panel.id, target.panelId, target.placement);
  };

  const startPanelDrag = (drag: PanelPointerDrag, event: ReactPointerEvent<HTMLElement>) => {
    const position = panelDragPreviewPosition(event, drag);
    drag.active = true;
    drag.previewLeft = position.left;
    drag.previewTop = position.top;
    setDragOverlay({
      ...position,
      panel: drag.panel,
    });
  };

  const updatePanelDragPreview = (event: ReactPointerEvent<HTMLElement>, drag: PanelPointerDrag) => {
    const position = panelDragPreviewPosition(event, drag);
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    drag.previewLeft = position.left;
    drag.previewTop = position.top;
    if (drag.previewFrame !== null) return;
    drag.previewFrame = window.requestAnimationFrame(() => {
      drag.previewFrame = null;
      if (pointerDragRef.current !== drag || !dragPreviewRef.current) return;
      dragPreviewRef.current.style.transform = `translate3d(${drag.previewLeft}px, ${drag.previewTop}px, 0)`;
      const crossSlotTarget = drag.crossSlotEnabled
        ? panelCrossSlotDropTargetAtPoint(drag.clientX, drag.clientY, placement)
        : null;
      if (crossSlotTarget) {
        drag.lastReorderTarget = null;
        updatePanelCrossSlotPlaceholder(drag, crossSlotTarget);
        return;
      }
      clearPanelCrossSlotPlaceholder(drag);
      // The blank slot moves at most once per frame and only after crossing a tab boundary.
      updateSameSlotReorderPreview(drag);
    });
  };

  useEffect(() => {
    return () => {
      const previewFrame = pointerDragRef.current?.previewFrame;
      if (previewFrame !== null && previewFrame !== undefined) window.cancelAnimationFrame(previewFrame);
      if (pointerDragRef.current) clearPanelCrossSlotPlaceholder(pointerDragRef.current);
      pointerDragRef.current = null;
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLSpanElement>, panel: DesktopPanelTab) => {
    if (!canDragPanel(panel) || event.button !== 0) return;
    if ((event.target as Element).closest('.chat-file-review-panel__tab-close')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const captureTarget = headerRef.current;
    if (!captureTarget) return;
    const scaleInverse = pageScaleInverse();
    pointerDragRef.current = {
      active: false,
      clientX: event.clientX,
      clientY: event.clientY,
      crossSlotEnabled: Boolean(onMovePanel && canMoveDesktopPanelAcrossSlots(panel, tabPanels)),
      crossSlotPlaceholder: null,
      crossSlotTarget: null,
      height: rect.height * scaleInverse,
      lastReorderTarget: null,
      offsetX: (event.clientX - rect.left) * scaleInverse,
      offsetY: (event.clientY - rect.top) * scaleInverse,
      panel,
      pointerId: event.pointerId,
      previewFrame: null,
      previewLeft: 0,
      previewTop: 0,
      scaleInverse,
      sourceElement: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width * scaleInverse,
    };
    // Capture on the stable header: React may move the blank source tab while sorting.
    captureTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.active && distance < PANEL_DRAG_START_DISTANCE) return;
    event.preventDefault();
    if (!drag.active) startPanelDrag(drag, event);
    updatePanelDragPreview(event, drag);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const suppressClick = drag.active;
    const shouldActivateTab = !drag.active && event.type === 'pointerup';
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (suppressClick) event.preventDefault();
    if (drag.active && event.type === 'pointerup') {
      const crossSlotTarget = drag.crossSlotEnabled
        ? panelCrossSlotDropTargetAtPoint(event.clientX, event.clientY, placement)
        : null;
      if (crossSlotTarget) {
        onMovePanel?.(
          drag.panel.id,
          crossSlotTarget.placement,
          crossSlotTarget.panelId,
          crossSlotTarget.position,
        );
      } else {
        const sameSlotTarget = sameSlotReorderTarget(event.clientX, event.clientY, drag.panel.id);
        const targetKey = sameSlotTarget
          ? panelReorderTargetKey(sameSlotTarget.panelId, sameSlotTarget.placement)
          : null;
        if (sameSlotTarget && targetKey !== drag.lastReorderTarget) {
          onReorderPanels?.(drag.panel.id, sameSlotTarget.panelId, sameSlotTarget.placement);
        }
      }
    }
    if (shouldActivateTab) {
      // 标签页包装元素负责捕获用于拖动排序的指针。在指针抬起时激活，避免浏览器
      // 跳过 click 事件时丢失普通点击。
      onSelectPanel?.(drag.panel.id);
      suppressFollowingClick();
    }
    clearDragState(suppressClick);
  };

  const handleTabClick = (event: ReactMouseEvent<HTMLButtonElement>, panelId: string) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      event.preventDefault();
      return;
    }
    onSelectPanel?.(panelId);
  };

  const handleTabExitAnimationEnd = (event: ReactAnimationEvent<HTMLSpanElement>, panelId: string) => {
    if (event.currentTarget !== event.target || event.animationName !== PANEL_TAB_EXIT_ANIMATION_NAME) return;
    finishPanelClose(panelId);
  };

  const renderTabLabel = (panel: DesktopPanelTab) => (
    <>
      <DesktopPanelIcon panel={panel} />
      <span className="chat-file-review-panel__tab-label">{desktopPanelTitle(panel, t)}</span>
      {panel.type === 'file' && panel.filePath && (isFileDirty ? isFileDirty(panel.filePath, panel.rootId) : panel.filePath === unsavedFilePath) ? (
        <span
          className="chat-file-review-panel__tab-unsaved"
          role="img"
          aria-label={t('workspace.files.unsaved')}
          title={t('workspace.files.unsaved')}
        />
      ) : null}
    </>
  );

  return (
    <div
      ref={headerRef}
      className={['desktop-panel-chrome', 'chat-file-review-panel__header', dragOverlay ? 'is-reordering-tabs' : ''].filter(Boolean).join(' ')}
      data-desktop-panel-placement={placement}
      data-workspace-panel-slot={placement}
      onPointerCancel={handlePointerEnd}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
    >
      <div className="chat-file-review-panel__heading">
        <span className="chat-file-review-panel__tab-strip">
          {(canScrollLeft || canScrollRight) ? (
            <Button variant="ghost"
              aria-label={t('workspace.panel.scrollTabsLeft')}
              aria-controls={tabsId}
              title={t('workspace.panel.scrollTabsLeft')}
              className="chat-file-review-panel__tab-scroll chat-file-review-panel__tab-scroll--left"
              disabled={!canScrollLeft}
              onClick={() => scrollTabs(-1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </Button>
          ) : null}
          <span className="chat-file-review-panel__tabs" id={tabsId} ref={tabsRef}>
            {tabPanels.map((panel) => {
              const closingWidth = closingPanelWidths[panel.id];
              const closing = closingWidth !== undefined;
              const closeLabel = t('workspace.panel.closeNamed', { title: desktopPanelTitle(panel, t) });
              const draggable = canDragPanel(panel);
              const tabStyle = closing
                ? { '--desktop-panel-tab-exit-width': `${closingWidth}px` } as CSSProperties
                : undefined;
              return (
                <span
                  className={[
                    'chat-file-review-panel__title',
                    activeId === panel.id ? 'chat-file-review-panel__title--active' : '',
                    onClosePanel ? 'chat-file-review-panel__title--closable' : '',
                    draggable ? 'chat-file-review-panel__title--sortable' : '',
                    draggedPanelId === panel.id ? 'is-dragging' : '',
                    closing ? 'is-closing' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-desktop-panel-tab-id={panel.id}
                  data-reorder-id={panel.id}
                  key={panel.id}
                  onAnimationEnd={closing ? (event) => handleTabExitAnimationEnd(event, panel.id) : undefined}
                  onPointerDown={(event) => handlePointerDown(event, panel)}
                  style={tabStyle}
                >
                  <Button variant="ghost"
                    className="chat-file-review-panel__tab-button"
                    disabled={closing}
                    type="button"
                    title={desktopPanelTitle(panel, t)}
                    onClick={(event) => handleTabClick(event, panel.id)}
                  >
                    {renderTabLabel(panel)}
                  </Button>
                  {onClosePanel ? (
                    <Tooltip
                      placement="bottom"
                      disabled={closing || Boolean(dragOverlay)}
                      title={activeId === panel.id
                        ? <ShortcutTooltipContent commandId="workspace.closeActiveSidePanel" label={closeLabel} />
                        : closeLabel}
                    >
                      <Button variant="ghost"
                        className="chat-file-review-panel__tab-close"
                        disabled={closing}
                        type="button"
                        aria-label={closeLabel}
                        onClick={(event) => {
                          event.stopPropagation();
                          const visualWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
                          startPanelClose(panel.id, visualWidth * pageScaleInverse());
                        }}
                      >
                        <span className="chat-file-review-panel__tab-close-glyph" aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  ) : null}
                </span>
              );
            })}
            {onAddPanel ? (
              <span className="desktop-panel-launcher">
                <Tooltip placement="bottom" title={<ShortcutTooltipContent commandId="workspace.addPanel" label={addPanelLabel} />}>
                  <Button variant="ghost"
                    aria-label={addPanelLabel}
                    className="app-shell-icon-control chat-file-review-panel__heading-action"
                    type="button"
                    onClick={() => onAddPanel()}
                  >
                    <Plus size={14} />
                  </Button>
                </Tooltip>
              </span>
            ) : null}
          </span>
          {(canScrollLeft || canScrollRight) ? (
            <Button variant="ghost"
              aria-label={t('workspace.panel.scrollTabsRight')}
              aria-controls={tabsId}
              title={t('workspace.panel.scrollTabsRight')}
              className="chat-file-review-panel__tab-scroll chat-file-review-panel__tab-scroll--right"
              disabled={!canScrollRight}
              onClick={() => scrollTabs(1)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </Button>
          ) : null}
        </span>
        <span className="chat-file-review-panel__heading-actions">
          {actions}
          {placement === 'side' && onToggleBottomTerminal ? (
            <ShortcutTooltip
              commandId="layout.toggleTerminal"
              label={t(bottomBarActive ? 'workspace.panel.hideBottom' : 'workspace.panel.showBottom')}
            >
              <Button variant="ghost"
                className={[
                  'app-shell-icon-control',
                  'chat-file-review-panel__close',
                  'chat-file-review-panel__terminal-action',
                  bottomBarActive ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                type="button"
                aria-label={t(bottomBarActive ? 'workspace.panel.hideBottom' : 'workspace.panel.showBottom')}
                aria-pressed={bottomBarActive}
                onClick={onToggleBottomTerminal}
              >
                <PanelPlacementIcon placement="bottom" />
              </Button>
            </ShortcutTooltip>
          ) : null}
          {placement === 'side' ? (
            <ShortcutTooltip commandId="layout.toggleWorkspace" label={t('workspace.panel.collapseSide')}>
              <Button variant="ghost"
                className="app-shell-icon-control chat-file-review-panel__close chat-file-review-panel__panel-close is-active"
                type="button"
                aria-label={t('workspace.panel.collapseSide')}
                aria-pressed={true}
                onClick={onClose}
              >
                <PanelPlacementIcon placement="side" />
              </Button>
            </ShortcutTooltip>
          ) : (
            <Button variant="ghost"
              className="app-shell-icon-control chat-file-review-panel__close chat-file-review-panel__panel-close"
              type="button"
              aria-label={t('workspace.panel.hideBottom')}
              title={t('workspace.panel.hideBottom')}
              onClick={onClose}
            >
              <ChevronDown size={14} />
            </Button>
          )}
        </span>
      </div>
      {dragOverlay ? (
        <span
          ref={dragPreviewRef}
          className={[
            'chat-file-review-panel__title',
            'chat-file-review-panel__title--drag-preview',
            activeId === dragOverlay.panel.id ? 'chat-file-review-panel__title--active' : '',
            onClosePanel ? 'chat-file-review-panel__title--closable' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            height: dragOverlay.height,
            left: 0,
            top: 0,
            transform: `translate3d(${pointerDragRef.current?.previewLeft ?? dragOverlay.left}px, ${pointerDragRef.current?.previewTop ?? dragOverlay.top}px, 0)`,
            width: dragOverlay.width,
          }}
        >
          <span className="chat-file-review-panel__tab-button">{renderTabLabel(dragOverlay.panel)}</span>
          {onClosePanel ? (
            <span className="chat-file-review-panel__tab-close" aria-hidden="true">
              <span className="chat-file-review-panel__tab-close-glyph" />
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function panelDragPreviewPosition(
  pointer: Pick<PointerEvent | ReactPointerEvent<HTMLElement>, 'clientX' | 'clientY'>,
  drag: Pick<PanelPointerDrag, 'height' | 'offsetX' | 'offsetY' | 'scaleInverse' | 'width'>,
): Omit<PanelDragOverlay, 'panel'> {
  return {
    height: drag.height,
    left: pointer.clientX * drag.scaleInverse - drag.offsetX,
    top: pointer.clientY * drag.scaleInverse - drag.offsetY,
    width: drag.width,
  };
}

export function panelCrossSlotDropTargetAtPoint(
  clientX: number,
  clientY: number,
  sourcePlacement: DesktopPanelPlacement,
): PanelCrossSlotDropTarget | null {
  const headers = Array.from(document.querySelectorAll<HTMLElement>('[data-desktop-panel-placement]'));
  const header = headers.find((candidate) => {
    if (candidate.dataset.desktopPanelPlacement === sourcePlacement) return false;
    const rect = candidate.getBoundingClientRect();
    return pointInsideRect(clientX, clientY, rect);
  });
  const targetPlacement = header?.dataset.desktopPanelPlacement;
  if (!header || (targetPlacement !== 'side' && targetPlacement !== 'bottom')) return null;

  const tabs = Array.from(header.querySelectorAll<HTMLElement>('[data-desktop-panel-tab-id]'));
  const nearestTab = tabs.length
    ? tabs.reduce((nearest, candidate) => {
        const candidateRect = reorderItemRect(candidate);
        const nearestRect = reorderItemRect(nearest);
        const candidateDistance = Math.abs(clientX - (candidateRect.left + candidateRect.width / 2));
        const nearestDistance = Math.abs(clientX - (nearestRect.left + nearestRect.width / 2));
        return candidateDistance < nearestDistance ? candidate : nearest;
      })
    : null;
  const tabRect = nearestTab ? reorderItemRect(nearestTab) : null;
  const position: DesktopPanelDropPlacement = tabRect && clientX < tabRect.left + tabRect.width / 2 ? 'before' : 'after';

  return {
    panelId: nearestTab?.dataset.desktopPanelTabId ?? null,
    placement: targetPlacement,
    position,
  };
}

function updatePanelCrossSlotPlaceholder(drag: PanelPointerDrag, target: PanelCrossSlotDropTarget): void {
  const targetKey = `${target.placement}:${target.panelId ?? 'empty'}:${target.position}`;
  if (targetKey === drag.crossSlotTarget && drag.crossSlotPlaceholder?.isConnected) return;

  const header = Array.from(document.querySelectorAll<HTMLElement>('[data-desktop-panel-placement]'))
    .find((candidate) => candidate.dataset.desktopPanelPlacement === target.placement);
  const tabs = header?.querySelector<HTMLElement>('.chat-file-review-panel__tabs');
  if (!tabs) {
    clearPanelCrossSlotPlaceholder(drag);
    return;
  }

  const placeholder = drag.crossSlotPlaceholder ?? document.createElement('span');
  placeholder.className = 'desktop-panel-tab-drop-placeholder';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.style.flex = `0 0 ${drag.width}px`;
  placeholder.style.height = `${drag.height}px`;
  placeholder.style.width = `${drag.width}px`;

  const targetTab = Array.from(tabs.querySelectorAll<HTMLElement>('[data-desktop-panel-tab-id]'))
    .find((candidate) => candidate.dataset.desktopPanelTabId === target.panelId) ?? null;
  const reference = targetTab
    ? target.position === 'before' ? targetTab : targetTab.nextSibling
    : tabs.querySelector('.desktop-panel-launcher');
  animateReorderLayout(tabs, () => tabs.insertBefore(placeholder, reference));
  drag.sourceElement.classList.add('is-cross-slot-targeting');
  drag.crossSlotPlaceholder = placeholder;
  drag.crossSlotTarget = targetKey;
}

function clearPanelCrossSlotPlaceholder(drag: PanelPointerDrag): void {
  const placeholder = drag.crossSlotPlaceholder;
  if (placeholder?.parentElement) animateReorderLayout(placeholder.parentElement, () => placeholder.remove());
  drag.sourceElement.classList.remove('is-cross-slot-targeting');
  drag.crossSlotPlaceholder = null;
  drag.crossSlotTarget = null;
}

function pageScaleInverse(): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-page-scale-inverse'));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function pointInsideRect(clientX: number, clientY: number, rect: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>): boolean {
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function panelReorderTargetKey(panelId: string, placement: DesktopPanelDropPlacement): string {
  return `${panelId}:${placement}`;
}
