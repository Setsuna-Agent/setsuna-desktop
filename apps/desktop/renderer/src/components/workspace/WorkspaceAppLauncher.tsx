import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { pageScaleInverse, zoomedPortalPosition, type ZoomedPortalPosition } from '../../utils/zoomedPortalPosition.js';
import { WorkspaceAppGlyph } from './PanelChrome.js';
import type { DesktopWorkspaceApp } from './model.js';

const WORKSPACE_APP_MENU_WIDTH = 196;
const WORKSPACE_APP_MENU_OFFSET = 6;

export function WorkspaceAppLauncher({
  selectedWorkspaceApp,
  workspaceAppMenuOpen,
  workspaceApps,
  onOpenCurrentWorkspaceApp,
  onSelectWorkspaceApp,
  onToggleWorkspaceAppMenu,
}: {
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  workspaceAppMenuOpen: boolean;
  workspaceApps: DesktopWorkspaceApp[];
  onOpenCurrentWorkspaceApp: () => void;
  onSelectWorkspaceApp: (app: DesktopWorkspaceApp) => void;
  onToggleWorkspaceAppMenu: () => void;
}) {
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<ZoomedPortalPosition>({ left: 8, top: 8 });

  const updateMenuPosition = useCallback(() => {
    const rect = launcherRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPosition(workspaceAppLauncherMenuPosition({
      menuHeight: menuRef.current?.offsetHeight ?? 0,
      menuWidth: menuRef.current?.offsetWidth ?? WORKSPACE_APP_MENU_WIDTH,
      rect,
      scaleInverse: pageScaleInverse(),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    }));
  }, []);

  useLayoutEffect(() => {
    if (!workspaceAppMenuOpen) return undefined;
    updateMenuPosition();
    const handlePointerDown = (event: PointerEvent) => {
      if (launcherRef.current?.contains(event.target as Node)) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      onToggleWorkspaceAppMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggleWorkspaceAppMenu();
    };
    const handleReposition = () => updateMenuPosition();
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    const appearanceObserver = new MutationObserver(handleReposition);
    appearanceObserver.observe(document.documentElement, {
      attributeFilter: ['data-font-size'],
      attributes: true,
    });
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
      appearanceObserver.disconnect();
    };
  }, [onToggleWorkspaceAppMenu, updateMenuPosition, workspaceAppMenuOpen, workspaceApps.length]);

  return (
    <div className="desktop-workspace-launcher" ref={launcherRef} role="group" aria-label="用本地应用打开工作区">
      <button
        className="desktop-workspace-launcher__main"
        type="button"
        disabled={!selectedWorkspaceApp}
        aria-label={selectedWorkspaceApp ? `用 ${selectedWorkspaceApp.label} 打开工作区` : '用本地应用打开工作区'}
        title={selectedWorkspaceApp?.label}
        onClick={onOpenCurrentWorkspaceApp}
      >
        <WorkspaceAppGlyph app={selectedWorkspaceApp} />
        <span className="desktop-workspace-launcher__label">{selectedWorkspaceApp?.label ?? '打开'}</span>
      </button>
      <button
        className={`desktop-workspace-launcher__trigger ${workspaceAppMenuOpen ? 'is-active' : ''}`}
        type="button"
        disabled={!workspaceApps.length}
        aria-expanded={workspaceAppMenuOpen}
        aria-haspopup="menu"
        aria-label="选择打开应用"
        onClick={() => {
          updateMenuPosition();
          onToggleWorkspaceAppMenu();
        }}
      >
        <ChevronDown size={13} />
      </button>
      {workspaceAppMenuOpen
        ? createPortal(
            <div
              className="desktop-workspace-launcher-menu desktop-workspace-launcher-menu--native"
              ref={menuRef}
              role="menu"
              style={menuPosition}
            >
              {workspaceApps.length ? (
                workspaceApps.map((app) => (
                  <button className={selectedWorkspaceApp?.id === app.id ? 'is-selected' : ''} key={app.id} type="button" role="menuitem" onClick={() => onSelectWorkspaceApp(app)}>
                    <span className="desktop-workspace-launcher__menu-main">
                      <WorkspaceAppGlyph app={app} />
                      <span>{app.label}</span>
                    </span>
                    {selectedWorkspaceApp?.id === app.id ? <Check className="desktop-workspace-launcher__menu-check" size={13} /> : null}
                  </button>
                ))
              ) : (
                <span>未检测到可打开的应用</span>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function workspaceAppLauncherMenuPosition({
  menuHeight,
  menuWidth,
  rect,
  scaleInverse = 1,
  viewportHeight,
  viewportWidth,
}: {
  menuHeight: number;
  menuWidth: number;
  rect: Pick<DOMRect, 'bottom' | 'right'>;
  scaleInverse?: number;
  viewportHeight: number;
  viewportWidth: number;
}): ZoomedPortalPosition {
  return zoomedPortalPosition({
    anchorX: rect.right,
    anchorY: rect.bottom,
    horizontalAlign: 'end',
    menuHeight,
    menuWidth,
    offsetY: WORKSPACE_APP_MENU_OFFSET,
    scaleInverse,
    viewportHeight,
    viewportWidth,
  });
}
