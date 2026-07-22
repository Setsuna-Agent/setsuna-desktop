import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { Check, ChevronRight, Code2, Copy, FolderOpen, MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { translate, useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { pageScaleInverse, zoomedPortalPosition } from '../../shared/lib/zoomedPortalPosition.js';
import { WorkspaceAppGlyph } from './PanelChrome.js';
import type { DesktopWorkspaceApp } from './model.js';

export type WorkspaceFileContextTarget = {
  filePath: string;
  line?: number;
  x: number;
  y: number;
};

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

export function WorkspaceFileContextMenu({
  selectedWorkspaceApp,
  target,
  workspaceApps,
  onAddToConversation,
  onClose,
  onCopyPath,
  onOpenWithApp,
  onReveal,
}: {
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  target: WorkspaceFileContextTarget | null;
  workspaceApps: DesktopWorkspaceApp[];
  onAddToConversation: (filePath: string) => void;
  onClose: () => void;
  onCopyPath: (filePath: string) => void;
  onOpenWithApp: (appId: string, filePath: string, line?: number) => void;
  onReveal: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [openWithMenuVisible, setOpenWithMenuVisible] = useState(false);

  useEffect(() => {
    setOpenWithMenuVisible(false);
  }, [target?.filePath, target?.line, target?.x, target?.y]);

  useEffect(() => {
    if (!target) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose, target]);

  useEffect(() => {
    if (!target) return undefined;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  if (!target || typeof document === 'undefined') return null;

  const style: CSSProperties = zoomedPortalPosition({
    anchorX: target.x,
    anchorY: target.y,
    menuHeight: 180,
    menuWidth: 236,
    scaleInverse: pageScaleInverse(),
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  });
  const submenuClasses = [
    'desktop-file-context-menu desktop-file-context-menu--submenu',
    target.x > window.innerWidth / 2 ? 'opens-left' : '',
    target.y > window.innerHeight / 2 ? 'opens-up' : '',
  ].filter(Boolean).join(' ');
  const runAndClose = (action: () => void) => {
    onClose();
    action();
  };

  return createPortal(
    <div
      className="desktop-file-context-menu"
      ref={menuRef}
      role="menu"
      style={style}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={!selectedWorkspaceApp}
        onClick={() => {
          if (!selectedWorkspaceApp) return;
          runAndClose(() => onOpenWithApp(selectedWorkspaceApp.id, target.filePath, target.line));
        }}
      >
        {selectedWorkspaceApp ? <WorkspaceAppGlyph app={selectedWorkspaceApp} /> : <Code2 size={14} />}
        <span>{selectedWorkspaceApp ? openInAppLabel(selectedWorkspaceApp, target.line, t) : t('workspace.fileMenu.noApp')}</span>
      </button>
      <div
        className="desktop-file-context-menu__submenu-host"
        onMouseEnter={() => setOpenWithMenuVisible(true)}
        onMouseLeave={() => setOpenWithMenuVisible(false)}
      >
        <button
          className="desktop-file-context-menu__submenu-trigger"
          type="button"
          role="menuitem"
          aria-expanded={openWithMenuVisible}
          aria-haspopup="menu"
          disabled={!workspaceApps.length}
          onClick={() => setOpenWithMenuVisible((visible) => !visible)}
          onFocus={() => setOpenWithMenuVisible(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') setOpenWithMenuVisible(true);
          }}
        >
          <Code2 size={14} />
          <span>{t('workspace.fileMenu.openWith')}</span>
          <ChevronRight className="desktop-file-context-menu__submenu-chevron" size={13} />
        </button>
        {openWithMenuVisible ? (
          <div className={submenuClasses} role="menu" aria-label={t('workspace.fileMenu.chooseApp')}>
            {workspaceApps.map((app) => (
              <button
                type="button"
                role="menuitem"
                key={app.id}
                onClick={() => runAndClose(() => onOpenWithApp(app.id, target.filePath, target.line))}
              >
                <WorkspaceAppGlyph app={app} />
                <span>{app.label}</span>
                {selectedWorkspaceApp?.id === app.id ? <Check className="desktop-file-context-menu__selected" size={13} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="desktop-file-context-menu__divider" role="separator" />
      <button type="button" role="menuitem" onClick={() => runAndClose(() => onCopyPath(target.filePath))}>
        <Copy size={14} />
        <span>{t('workspace.fileMenu.copyPath')}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => runAndClose(() => onReveal(target.filePath))}>
        <FolderOpen size={14} />
        <span>{workspaceFileRevealLabel(window.setsunaDesktop?.desktop.platform, t)}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => runAndClose(() => onAddToConversation(target.filePath))}>
        <MessageSquare size={14} />
        <span>{t('workspace.fileMenu.addToChat')}</span>
      </button>
    </div>,
    document.body,
  );
}

export function workspaceFileRevealLabel(platform?: string, t: Translate = defaultTranslate): string {
  if (platform === 'darwin') return t('workspace.fileMenu.reveal.finder');
  if (platform === 'win32') return t('workspace.fileMenu.reveal.explorer');
  return t('workspace.fileMenu.reveal.folder');
}

export function workspaceFileMentionEntry(filePath: string): WorkspaceEntrySearchItem {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const separatorIndex = normalizedPath.lastIndexOf('/');
  return {
    kind: 'file',
    name: separatorIndex >= 0 ? normalizedPath.slice(separatorIndex + 1) : normalizedPath,
    parent: separatorIndex >= 0 ? normalizedPath.slice(0, separatorIndex) : '',
    path: normalizedPath,
  };
}

function openInAppLabel(app: DesktopWorkspaceApp, line: number | undefined, t: Translate): string {
  const supportsLine = ['cursor', 'intellij-idea', 'pycharm', 'vscode', 'webstorm'].includes(app.id);
  return line && supportsLine
    ? t('workspace.fileMenu.openLineInApp', { app: app.label, line })
    : t('workspace.fileMenu.openInApp', { app: app.label });
}
