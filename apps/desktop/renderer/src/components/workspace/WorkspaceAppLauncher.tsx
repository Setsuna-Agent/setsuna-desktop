import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { WorkspaceAppGlyph } from './PanelChrome.js';
import type { DesktopWorkspaceApp } from './model.js';

type WorkspaceAppLauncherPosition = {
  right: number;
  top: number;
};

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
  const [menuPosition, setMenuPosition] = useState<WorkspaceAppLauncherPosition>({ right: 8, top: 0 });

  const updateMenuPosition = () => {
    const rect = launcherRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPosition({
      right: Math.max(8, window.innerWidth - rect.right),
      top: rect.bottom + 6,
    });
  };

  useEffect(() => {
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
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [onToggleWorkspaceAppMenu, workspaceAppMenuOpen]);

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
              style={{ right: menuPosition.right, top: menuPosition.top } as CSSProperties}
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
