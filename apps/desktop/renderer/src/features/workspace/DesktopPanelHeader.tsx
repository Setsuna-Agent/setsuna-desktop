import { Bug, FileDiff, FolderOpen, Globe2, MessageSquare, Plus, Terminal, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import type { KeyboardShortcutCommandId } from '../../shared/shortcuts/keyboardShortcutCommands.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import { usePanelTabCloseTransition } from './hooks/usePanelTabCloseTransition.js';
import { DesktopPanelIcon, desktopPanelTitle } from './PanelChrome.js';
import { PanelPlacementIcon } from './PanelPlacementIcon.js';
import type { DesktopPanelDropPlacement, DesktopPanelTab, DesktopPanelType } from './model.js';

export type DesktopPanelPlacement = 'side' | 'bottom';

const panelLauncherItems: Array<{ key: DesktopPanelType; labelKey: MessageKey; icon: JSX.Element }> = [
  { key: 'chat', labelKey: 'workspace.panel.launcher.sideChat', icon: <MessageSquare size={14} /> },
  { key: 'browser', labelKey: 'workspace.panel.launcher.browser', icon: <Globe2 size={14} /> },
  { key: 'conversation-debug', labelKey: 'workspace.panel.launcher.conversationDebug', icon: <Bug size={14} /> },
  { key: 'review', labelKey: 'workspace.panel.launcher.review', icon: <FileDiff size={14} /> },
  { key: 'files', labelKey: 'workspace.panel.launcher.files', icon: <FolderOpen size={14} /> },
  { key: 'terminal', labelKey: 'workspace.panel.launcher.terminal', icon: <Terminal size={14} /> },
];

const panelLauncherShortcutCommands: Partial<Record<DesktopPanelType, KeyboardShortcutCommandId>> = {
  files: 'workspace.openFiles',
  review: 'workspace.openReview',
};

type PanelPointerDrag = {
  active: boolean;
  clientX: number;
  clientY: number;
  crossSlotPlaceholder: HTMLSpanElement | null;
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
const PANEL_LAUNCHER_MENU_WIDTH = 156;
const PANEL_LAUNCHER_VIEWPORT_INSET = 8;
const PANEL_TAB_EXIT_ANIMATION_NAME = 'desktop-panel-tab-exit';

export function DesktopPanelHeader({
  activePanel,
  activePanelId,
  availablePanelTypes,
  bottomBarActive = false,
  onClose,
  onClosePanel,
  onMovePanel,
  onOpenPanel,
  onReorderPanels,
  onSelectPanel,
  onToggleBottomTerminal,
  panels,
  placement,
}: {
  activePanel: DesktopPanelType;
  activePanelId?: string | null;
  availablePanelTypes?: DesktopPanelType[];
  bottomBarActive?: boolean;
  onClose: () => void;
  onClosePanel?: (panelId: string) => void;
  onMovePanel?: (
    panelId: string,
    targetPlacement: DesktopPanelPlacement,
    targetPanelId: string | null,
    position: DesktopPanelDropPlacement,
  ) => void;
  onOpenPanel?: (panel: DesktopPanelType) => void;
  onReorderPanels?: (panelId: string, targetPanelId: string, placement: DesktopPanelDropPlacement) => void;
  onSelectPanel?: (panelId: string) => void;
  onToggleBottomTerminal?: () => void;
  panels?: DesktopPanelTab[];
  placement: DesktopPanelPlacement;
}) {
  const { t } = useI18n();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState({ left: 0, top: 0 });
  const [dragOverlay, setDragOverlay] = useState<PanelDragOverlay | null>(null);
  const pointerDragRef = useRef<PanelPointerDrag | null>(null);
  const dragPreviewRef = useRef<HTMLSpanElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const suppressNextClickRef = useRef(false);
  const tabsRef = useRef<HTMLSpanElement | null>(null);
  const launcherRef = useRef<HTMLSpanElement | null>(null);
  const launcherButtonRef = useRef<HTMLButtonElement | null>(null);
  const launcherMenuRef = useRef<HTMLSpanElement | null>(null);
  const {
    closingPanelWidths,
    finishPanelClose,
    startPanelClose,
  } = usePanelTabCloseTransition(onClosePanel);
  const activeId = activePanelId || activePanel;
  const tabPanels = panels?.length ? panels : [{ id: activeId, type: activePanel }];
  const availableTypeSet = new Set(availablePanelTypes || panelLauncherItems.map((item) => item.key));
  const hasReviewPanel = tabPanels.some((panel) => panel.type === 'review');
  const hasFilesPanel = tabPanels.some((panel) => panel.type === 'files');
  const launcherItems = panelLauncherItems.filter(
    (item) => availableTypeSet.has(item.key)
      && (item.key !== 'review' || !hasReviewPanel)
      && (item.key !== 'files' || !hasFilesPanel),
  );
  const sortable = Boolean(onReorderPanels && tabPanels.length > 1);
  const draggable = sortable || Boolean(onMovePanel);
  const draggedPanelId = dragOverlay?.panel.id ?? null;

  const updateLauncherPosition = () => {
    const rect = launcherButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLauncherPosition(panelLauncherMenuPosition(rect, window.innerWidth, pageScaleInverse()));
  };

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
        const rect = element.getBoundingClientRect();
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
    setLauncherOpen(false);
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
      const crossSlotTarget = onMovePanel
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
    if (!launcherOpen) return undefined;
    updateLauncherPosition();
    const handlePointerDown = (event: PointerEvent) => {
      if (launcherRef.current?.contains(event.target as Node)) return;
      if (launcherMenuRef.current?.contains(event.target as Node)) return;
      setLauncherOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLauncherOpen(false);
    };
    const handleReposition = () => updateLauncherPosition();
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [launcherOpen]);

  useEffect(() => {
    return () => {
      const previewFrame = pointerDragRef.current?.previewFrame;
      if (previewFrame !== null && previewFrame !== undefined) window.cancelAnimationFrame(previewFrame);
      if (pointerDragRef.current) clearPanelCrossSlotPlaceholder(pointerDragRef.current);
      pointerDragRef.current = null;
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLSpanElement>, panel: DesktopPanelTab) => {
    if (!draggable || event.button !== 0) return;
    if ((event.target as Element).closest('.chat-file-review-panel__tab-close')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const captureTarget = headerRef.current;
    if (!captureTarget) return;
    const scaleInverse = pageScaleInverse();
    pointerDragRef.current = {
      active: false,
      clientX: event.clientX,
      clientY: event.clientY,
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
    if (!draggable || !drag || drag.pointerId !== event.pointerId) return;
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
      const crossSlotTarget = onMovePanel
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
    </>
  );

  return (
    <div
      ref={headerRef}
      className={['desktop-panel-chrome', 'chat-file-review-panel__header', dragOverlay ? 'is-reordering-tabs' : ''].filter(Boolean).join(' ')}
      data-desktop-panel-placement={placement}
      onPointerCancel={handlePointerEnd}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
    >
      <div className="chat-file-review-panel__heading">
        <span className="chat-file-review-panel__tabs" ref={tabsRef}>
          {tabPanels.map((panel) => {
            const closingWidth = closingPanelWidths[panel.id];
            const closing = closingWidth !== undefined;
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
                key={panel.id}
                onAnimationEnd={closing ? (event) => handleTabExitAnimationEnd(event, panel.id) : undefined}
                onPointerDown={(event) => handlePointerDown(event, panel)}
                style={tabStyle}
              >
                <button
                  className="chat-file-review-panel__tab-button"
                  disabled={closing}
                  type="button"
                  title={desktopPanelTitle(panel, t)}
                  onClick={(event) => handleTabClick(event, panel.id)}
                >
                  {renderTabLabel(panel)}
                </button>
                {onClosePanel ? (
                  <button
                    className="chat-file-review-panel__tab-close"
                    disabled={closing}
                    type="button"
                    aria-label={t('workspace.panel.closeNamed', { title: desktopPanelTitle(panel, t) })}
                    onClick={(event) => {
                      event.stopPropagation();
                      const visualWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
                      startPanelClose(panel.id, visualWidth * pageScaleInverse());
                    }}
                  >
                    <span className="chat-file-review-panel__tab-close-glyph" aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            );
          })}
          {onOpenPanel && launcherItems.length ? (
            <span className="desktop-panel-launcher" ref={launcherRef}>
              <button
                ref={launcherButtonRef}
                aria-expanded={launcherOpen}
                aria-haspopup="menu"
                aria-label={t('workspace.panel.add')}
                className="chat-file-review-panel__heading-action"
                type="button"
                onClick={() => {
                  updateLauncherPosition();
                  setLauncherOpen((value) => !value);
                }}
              >
                <Plus size={14} />
              </button>
              {launcherOpen
                ? createPortal(
                    <span
                      className="desktop-panel-launcher-menu desktop-panel-launcher-menu--native"
                      ref={launcherMenuRef}
                      role="menu"
                      style={{ left: launcherPosition.left, top: launcherPosition.top }}
                    >
                      {launcherItems.map((item) => {
                        const button = (
                          <button
                            key={item.key}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setLauncherOpen(false);
                              onOpenPanel(item.key);
                            }}
                          >
                            {item.icon}
                            {t(item.labelKey)}
                          </button>
                        );
                        const shortcutCommandId = panelLauncherShortcutCommands[item.key];
                        return shortcutCommandId ? (
                          <ShortcutTooltip
                            commandId={shortcutCommandId}
                            key={item.key}
                            label={t(item.labelKey)}
                            placement="bottom"
                          >
                            {button}
                          </ShortcutTooltip>
                        ) : button;
                      })}
                    </span>,
                    document.body,
                  )
                : null}
            </span>
          ) : null}
        </span>
        <span className="chat-file-review-panel__heading-actions">
          {placement === 'side' && onToggleBottomTerminal ? (
            <ShortcutTooltip
              commandId="layout.toggleTerminal"
              label={t(bottomBarActive ? 'workspace.panel.closeBottom' : 'workspace.panel.openBottomTerminal')}
            >
              <button
                className={[
                  'app-shell-icon-control',
                  'chat-file-review-panel__close',
                  'chat-file-review-panel__terminal-action',
                  bottomBarActive ? 'chat-file-review-panel__close--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                type="button"
                aria-label={t(bottomBarActive ? 'workspace.panel.closeBottom' : 'workspace.panel.openBottomTerminal')}
                aria-pressed={bottomBarActive}
                onClick={onToggleBottomTerminal}
              >
                <PanelPlacementIcon placement="bottom" />
              </button>
            </ShortcutTooltip>
          ) : null}
          {placement === 'side' ? (
            <ShortcutTooltip commandId="layout.toggleWorkspace" label={t('workspace.panel.collapseSide')}>
              <button
                className="app-shell-icon-control chat-file-review-panel__close chat-file-review-panel__panel-close chat-file-review-panel__close--active"
                type="button"
                aria-label={t('workspace.panel.collapseSide')}
                aria-pressed={true}
                onClick={onClose}
              >
                <PanelPlacementIcon placement="side" />
              </button>
            </ShortcutTooltip>
          ) : (
            <button
              className="chat-file-review-panel__close chat-file-review-panel__panel-close"
              type="button"
              aria-label={t('workspace.panel.close')}
              title={t('workspace.panel.close')}
              onClick={onClose}
            >
              <X size={14} />
            </button>
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

export function panelLauncherMenuPosition(
  rect: Pick<DOMRect, 'bottom' | 'left'>,
  viewportWidth: number,
  scaleInverse = 1,
): { left: number; top: number } {
  const viewportCssWidth = viewportWidth * scaleInverse;
  const rectLeftCss = rect.left * scaleInverse;
  const rectBottomCss = rect.bottom * scaleInverse;
  const maxLeft = Math.max(PANEL_LAUNCHER_VIEWPORT_INSET, viewportCssWidth - PANEL_LAUNCHER_MENU_WIDTH - PANEL_LAUNCHER_VIEWPORT_INSET);
  const preferredLeft = rectLeftCss;
  return {
    left: Math.min(Math.max(PANEL_LAUNCHER_VIEWPORT_INSET, preferredLeft), maxLeft),
    top: rectBottomCss + 6,
  };
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
        const candidateRect = candidate.getBoundingClientRect();
        const nearestRect = nearest.getBoundingClientRect();
        const candidateDistance = Math.abs(clientX - (candidateRect.left + candidateRect.width / 2));
        const nearestDistance = Math.abs(clientX - (nearestRect.left + nearestRect.width / 2));
        return candidateDistance < nearestDistance ? candidate : nearest;
      })
    : null;
  const tabRect = nearestTab?.getBoundingClientRect();
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
  tabs.insertBefore(placeholder, reference);
  drag.sourceElement.classList.add('is-cross-slot-targeting');
  drag.crossSlotPlaceholder = placeholder;
  drag.crossSlotTarget = targetKey;
}

function clearPanelCrossSlotPlaceholder(drag: PanelPointerDrag): void {
  drag.crossSlotPlaceholder?.remove();
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
