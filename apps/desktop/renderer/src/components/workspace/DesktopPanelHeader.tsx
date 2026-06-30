import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { FileText, FolderOpen, PanelRight, Plus, Terminal, X } from 'lucide-react';
import { DesktopPanelIcon, desktopPanelTitle } from './PanelChrome.js';
import type { DesktopPanelDropPlacement, DesktopPanelTab, DesktopPanelType } from './model.js';

export type DesktopPanelPlacement = 'side' | 'bottom';

const panelLauncherItems: Array<{ key: DesktopPanelType; label: string; icon: JSX.Element }> = [
  { key: 'review', label: '审查', icon: <FileText size={14} /> },
  { key: 'files', label: '文件', icon: <FolderOpen size={14} /> },
  { key: 'terminal', label: '终端', icon: <Terminal size={14} /> },
];

type PanelPointerDrag = {
  active: boolean;
  height: number;
  offsetX: number;
  offsetY: number;
  panel: DesktopPanelTab;
  pointerId: number;
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

const PANEL_DRAG_START_DISTANCE = 4;

export function DesktopPanelHeader({
  activePanel,
  activePanelId,
  availablePanelTypes,
  bottomBarActive = false,
  onClose,
  onClosePanel,
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
  onOpenPanel?: (panel: DesktopPanelType) => void;
  onReorderPanels?: (panelId: string, targetPanelId: string, placement: DesktopPanelDropPlacement) => void;
  onSelectPanel?: (panelId: string) => void;
  onToggleBottomTerminal?: () => void;
  panels?: DesktopPanelTab[];
  placement: DesktopPanelPlacement;
}) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState({ left: 0, top: 0 });
  const [dragOverlay, setDragOverlay] = useState<PanelDragOverlay | null>(null);
  const pointerDragRef = useRef<PanelPointerDrag | null>(null);
  const suppressNextClickRef = useRef(false);
  const tabsRef = useRef<HTMLSpanElement | null>(null);
  const launcherRef = useRef<HTMLSpanElement | null>(null);
  const launcherButtonRef = useRef<HTMLButtonElement | null>(null);
  const launcherMenuRef = useRef<HTMLSpanElement | null>(null);
  const activeId = activePanelId || activePanel;
  const tabPanels = panels?.length ? panels : [{ id: activeId, type: activePanel }];
  const availableTypeSet = new Set(availablePanelTypes || panelLauncherItems.map((item) => item.key));
  const hasReviewPanel = tabPanels.some((panel) => panel.type === 'review');
  const hasFilesPanel = tabPanels.some((panel) => panel.type === 'files');
  const launcherItems = panelLauncherItems.filter(
    (item) => availableTypeSet.has(item.key) && (item.key !== 'review' || !hasReviewPanel) && (item.key !== 'files' || !hasFilesPanel),
  );
  const sortable = Boolean(onReorderPanels && tabPanels.length > 1);
  const draggedPanelId = dragOverlay?.panel.id ?? null;

  const updateLauncherPosition = () => {
    const rect = launcherButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLauncherPosition({ left: rect.left, top: rect.bottom + 6 });
  };

  const clearDragState = (suppressClick: boolean) => {
    pointerDragRef.current = null;
    setDragOverlay(null);
    if (!suppressClick) return;
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
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

  const startPanelDrag = (drag: PanelPointerDrag, event: ReactPointerEvent<HTMLSpanElement>) => {
    drag.active = true;
    setLauncherOpen(false);
    setDragOverlay({
      height: drag.height,
      left: event.clientX - drag.offsetX,
      panel: drag.panel,
      top: event.clientY - drag.offsetY,
      width: drag.width,
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
      pointerDragRef.current = null;
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLSpanElement>, panel: DesktopPanelTab) => {
    if (!sortable || event.button !== 0) return;
    if ((event.target as Element).closest('.chat-file-review-panel__tab-close')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointerDragRef.current = {
      active: false,
      height: rect.height,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = pointerDragRef.current;
    if (!sortable || !drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.active && distance < PANEL_DRAG_START_DISTANCE) return;
    event.preventDefault();
    if (!drag.active) startPanelDrag(drag, event);

    setDragOverlay({
      height: drag.height,
      left: event.clientX - drag.offsetX,
      panel: drag.panel,
      top: event.clientY - drag.offsetY,
      width: drag.width,
    });

    const target = nextReorderTarget(event.clientX, drag.panel.id);
    if (!target) return;
    onReorderPanels?.(drag.panel.id, target.panelId, target.placement);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const suppressClick = drag.active;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (suppressClick) event.preventDefault();
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

  const renderTabLabel = (panel: DesktopPanelTab) => (
    <>
      <DesktopPanelIcon panel={panel} />
      <span className="chat-file-review-panel__tab-label">{desktopPanelTitle(panel)}</span>
    </>
  );

  return (
    <div className={['chat-file-review-panel__header', dragOverlay ? 'is-reordering-tabs' : ''].filter(Boolean).join(' ')}>
      <div className="chat-file-review-panel__heading">
        <span className="chat-file-review-panel__tabs" ref={tabsRef}>
          {tabPanels.map((panel) => (
            <span
              className={[
                'chat-file-review-panel__title',
                activeId === panel.id ? 'chat-file-review-panel__title--active' : '',
                onClosePanel ? 'chat-file-review-panel__title--closable' : '',
                sortable ? 'chat-file-review-panel__title--sortable' : '',
                draggedPanelId === panel.id ? 'is-dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-desktop-panel-tab-id={panel.id}
              key={panel.id}
              onPointerCancel={handlePointerEnd}
              onPointerDown={(event) => handlePointerDown(event, panel)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
            >
              <button
                className="chat-file-review-panel__tab-button"
                type="button"
                title={desktopPanelTitle(panel)}
                onClick={(event) => handleTabClick(event, panel.id)}
              >
                {renderTabLabel(panel)}
              </button>
              {onClosePanel ? (
                <button
                  className="chat-file-review-panel__tab-close"
                  type="button"
                  aria-label={`关闭${desktopPanelTitle(panel)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClosePanel(panel.id);
                  }}
                >
                  <span className="chat-file-review-panel__tab-close-glyph" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))}
          {onOpenPanel && launcherItems.length ? (
            <span className="desktop-panel-launcher" ref={launcherRef}>
              <button
                ref={launcherButtonRef}
                aria-expanded={launcherOpen}
                aria-haspopup="menu"
                aria-label="添加面板"
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
                      {launcherItems.map((item) => (
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
                          {item.label}
                        </button>
                      ))}
                    </span>,
                    document.body,
                  )
                : null}
            </span>
          ) : null}
        </span>
        <span className="chat-file-review-panel__heading-actions">
          {placement === 'side' && onToggleBottomTerminal ? (
            <button
              className={[
                'chat-file-review-panel__close',
                'chat-file-review-panel__terminal-action',
                bottomBarActive ? 'chat-file-review-panel__close--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              aria-label={bottomBarActive ? '关闭底栏' : '打开底栏终端'}
              onClick={onToggleBottomTerminal}
            >
              <Terminal size={14} />
            </button>
          ) : null}
          <button
            className={[
              'chat-file-review-panel__close',
              'chat-file-review-panel__panel-close',
              placement === 'side' ? 'chat-file-review-panel__close--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            type="button"
            aria-label={placement === 'side' ? '收起右侧栏' : '关闭面板'}
            title={placement === 'side' ? '收起右侧栏' : '关闭面板'}
            onClick={onClose}
          >
            {placement === 'side' ? <PanelRight size={14} /> : <X size={14} />}
          </button>
        </span>
      </div>
      {dragOverlay ? (
        <span
          className={[
            'chat-file-review-panel__title',
            'chat-file-review-panel__title--drag-preview',
            activeId === dragOverlay.panel.id ? 'chat-file-review-panel__title--active' : '',
            onClosePanel ? 'chat-file-review-panel__title--closable' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ height: dragOverlay.height, left: dragOverlay.left, top: dragOverlay.top, width: dragOverlay.width }}
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
