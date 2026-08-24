import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DesktopWorkspaceApp } from '../contracts/index.js';
import { WorkspaceAppGlyph } from './WorkspaceAppGlyph.js';
import './workspace-apps.css';

const WORKSPACE_APP_MENU_WIDTH = 196;
const WORKSPACE_APP_MENU_OFFSET = 6;
const VIEWPORT_GUTTER = 8;

type WorkspaceAppMenuPosition = Readonly<{
  left: number;
  top: number;
}>;

export function WorkspaceAppLauncher({
  selectedWorkspaceApp,
  workspaceAppMenuOpen,
  workspaceApps,
  onOpenCurrentWorkspaceApp,
  onSelectWorkspaceApp,
  onToggleWorkspaceAppMenu,
  translate,
}: Readonly<{
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  workspaceAppMenuOpen: boolean;
  workspaceApps: DesktopWorkspaceApp[];
  onOpenCurrentWorkspaceApp: () => void;
  onSelectWorkspaceApp: (app: DesktopWorkspaceApp) => void;
  onToggleWorkspaceAppMenu: () => void;
  translate: RendererTranslate;
}>) {
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<WorkspaceAppMenuPosition>({ left: 8, top: 8 });

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
    <div className="desktop-workspace-launcher" ref={launcherRef} role="group" aria-label={translate('feature.workspaceApps.launcher.label')}>
      <button
        className="desktop-workspace-launcher__main"
        type="button"
        disabled={!selectedWorkspaceApp}
        aria-label={selectedWorkspaceApp
          ? translate('feature.workspaceApps.launcher.openWith', { app: selectedWorkspaceApp.label })
          : translate('feature.workspaceApps.launcher.label')}
        title={selectedWorkspaceApp?.label}
        onClick={onOpenCurrentWorkspaceApp}
      >
        <WorkspaceAppGlyph app={selectedWorkspaceApp} />
        <span className="desktop-workspace-launcher__label">
          {selectedWorkspaceApp?.label ?? translate('feature.workspaceApps.launcher.open')}
        </span>
      </button>
      <button
        className={`desktop-workspace-launcher__trigger ${workspaceAppMenuOpen ? 'is-active' : ''}`}
        type="button"
        disabled={!workspaceApps.length}
        aria-expanded={workspaceAppMenuOpen}
        aria-haspopup="menu"
        aria-label={translate('feature.workspaceApps.launcher.choose')}
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
                <span>{translate('feature.workspaceApps.launcher.noApps')}</span>
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
}): WorkspaceAppMenuPosition {
  const safeScaleInverse = Number.isFinite(scaleInverse) && scaleInverse > 0
    ? scaleInverse
    : 1;
  const scaledViewportWidth = viewportWidth * safeScaleInverse;
  const scaledViewportHeight = viewportHeight * safeScaleInverse;
  const desiredLeft = rect.right * safeScaleInverse - menuWidth;
  const desiredTop = rect.bottom * safeScaleInverse + WORKSPACE_APP_MENU_OFFSET;
  const maxLeft = Math.max(VIEWPORT_GUTTER, scaledViewportWidth - menuWidth - VIEWPORT_GUTTER);
  const maxTop = Math.max(VIEWPORT_GUTTER, scaledViewportHeight - menuHeight - VIEWPORT_GUTTER);
  return {
    left: Math.min(Math.max(VIEWPORT_GUTTER, desiredLeft), maxLeft),
    top: Math.min(Math.max(VIEWPORT_GUTTER, desiredTop), maxTop),
  };
}

function pageScaleInverse(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 1;
  const value = Number.parseFloat(
    window.getComputedStyle(document.documentElement).getPropertyValue('--app-page-scale-inverse'),
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
}
