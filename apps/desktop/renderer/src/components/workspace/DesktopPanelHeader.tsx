import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, FolderOpen, PanelRight, Plus, Terminal, X } from 'lucide-react';
import { DesktopPanelIcon, desktopPanelTitle } from './PanelChrome.js';
import type { DesktopPanelTab, DesktopPanelType } from './model.js';

export type DesktopPanelPlacement = 'side' | 'bottom';

const panelLauncherItems: Array<{ key: DesktopPanelType; label: string; icon: JSX.Element }> = [
  { key: 'review', label: '审查', icon: <FileText size={14} /> },
  { key: 'files', label: '文件', icon: <FolderOpen size={14} /> },
  { key: 'terminal', label: '终端', icon: <Terminal size={14} /> },
];

export function DesktopPanelHeader({
  activePanel,
  activePanelId,
  availablePanelTypes,
  bottomBarActive = false,
  onClose,
  onClosePanel,
  onOpenPanel,
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
  onSelectPanel?: (panelId: string) => void;
  onToggleBottomTerminal?: () => void;
  panels?: DesktopPanelTab[];
  placement: DesktopPanelPlacement;
}) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState({ left: 0, top: 0 });
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

  const updateLauncherPosition = () => {
    const rect = launcherButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLauncherPosition({ left: rect.left, top: rect.bottom + 6 });
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

  return (
    <div className="chat-file-review-panel__header">
      <div className="chat-file-review-panel__heading">
        <span className="chat-file-review-panel__tabs">
          {tabPanels.map((panel) => (
            <span
              className={[
                'chat-file-review-panel__title',
                activeId === panel.id ? 'chat-file-review-panel__title--active' : '',
                onClosePanel ? 'chat-file-review-panel__title--closable' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              key={panel.id}
            >
              <button
                className="chat-file-review-panel__tab-button"
                type="button"
                title={desktopPanelTitle(panel)}
                onClick={() => onSelectPanel?.(panel.id)}
              >
                <DesktopPanelIcon panel={panel} />
                <span className="chat-file-review-panel__tab-label">{desktopPanelTitle(panel)}</span>
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
    </div>
  );
}
