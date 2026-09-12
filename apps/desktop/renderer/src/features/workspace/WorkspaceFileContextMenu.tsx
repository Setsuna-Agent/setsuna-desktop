import { PointMenu, type MenuItem } from '@setsuna-desktop/renderer-ui';
import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { Code2, Copy, FilePlus2, FolderOpen, FolderPlus, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { translate, useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { WorkspaceAppGlyph, workspaceOpenWithMenu } from '../../composition/workspace-apps-feature-adapter.js';
import type { DesktopWorkspaceApp } from './model.js';
import { workspaceEntryParent } from './workspaceEntryPaths.js';

export type WorkspaceFileContextTarget = {
  filePath: string;
  line?: number;
  type?: WorkspaceEntry['type'];
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
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
  entryActionsDisabled,
  onOpenWithApp,
  onReveal,
}: {
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  target: WorkspaceFileContextTarget | null;
  workspaceApps: DesktopWorkspaceApp[];
  onAddToConversation: (filePath: string, type: WorkspaceEntry['type']) => void;
  onClose: () => void;
  onCopyPath: (filePath: string) => void;
  onCreateEntry?: (parentPath: string, type: WorkspaceEntry['type']) => void;
  onRenameEntry?: (entryPath: string, type: WorkspaceEntry['type']) => void;
  onDeleteEntry?: (entryPath: string) => void;
  entryActionsDisabled?: boolean;
  onOpenWithApp: (appId: string, filePath: string, line?: number) => void;
  onReveal: (filePath: string) => void;
}) {
  const { t } = useI18n();
  if (!target) return null;
  const directory = target.type === 'directory';
  const workspaceRoot = directory && !target.filePath;
  const items: MenuItem[] = [
    ...(onCreateEntry ? [
      { key: 'new-file', label: t('workspace.fileMenu.newFile'), icon: <FilePlus2 size={14} />, disabled: entryActionsDisabled,
        onClick: () => onCreateEntry(directory ? target.filePath : workspaceEntryParent(target.filePath), 'file') },
      { key: 'new-folder', label: t('workspace.fileMenu.newFolder'), icon: <FolderPlus size={14} />, disabled: entryActionsDisabled,
        onClick: () => onCreateEntry(directory ? target.filePath : workspaceEntryParent(target.filePath), 'directory') },
      ...(!workspaceRoot ? [{ type: 'divider' as const }] : []),
    ] : []),
    ...(onRenameEntry && target.filePath ? [
      { key: 'rename', label: t('workspace.fileMenu.rename'), icon: <Pencil size={14} />, disabled: entryActionsDisabled,
        onClick: () => onRenameEntry(target.filePath, target.type ?? 'file') },
      { type: 'divider' as const },
    ] : []),
    ...(!directory ? [
      {
        key: 'open',
        label: selectedWorkspaceApp ? openInAppLabel(selectedWorkspaceApp, target.line, t) : t('workspace.fileMenu.noApp'),
        icon: selectedWorkspaceApp ? <WorkspaceAppGlyph app={selectedWorkspaceApp} /> : <Code2 size={14} />,
        disabled: !selectedWorkspaceApp,
        onClick: () => { if (selectedWorkspaceApp) onOpenWithApp(selectedWorkspaceApp.id, target.filePath, target.line); },
      },
      workspaceOpenWithMenu({
        label: t('workspace.fileMenu.openWith'), apps: workspaceApps,
        onOpen: (appId) => onOpenWithApp(appId, target.filePath, target.line),
      }),
      { type: 'divider' as const },
    ] : []),
    ...(!workspaceRoot ? [
      { key: 'copy', label: t(directory ? 'workspace.fileMenu.copyDirectoryPath' : 'workspace.fileMenu.copyPath'), icon: <Copy size={14} />, onClick: () => onCopyPath(target.filePath) },
      { key: 'reveal', label: workspaceFileRevealLabel(window.setsunaDesktop?.desktop.platform, t), icon: <FolderOpen size={14} />, onClick: () => onReveal(target.filePath) },
      { key: 'add', label: t('workspace.fileMenu.addToChat'), icon: <MessageSquare size={14} />, onClick: () => onAddToConversation(target.filePath, target.type ?? 'file') },
    ] : []),
    ...(onDeleteEntry && !workspaceRoot ? [
      { type: 'divider' as const },
      { key: 'delete', label: t('workspace.fileMenu.delete'), icon: <Trash2 size={14} />, danger: true,
        disabled: entryActionsDisabled, onClick: () => onDeleteEntry(target.filePath) },
    ] : []),
  ];
  return <PointMenu key={`${target.filePath}:${target.x}:${target.y}`} x={target.x} y={target.y}
    menu={{ items, selectedKeys: selectedWorkspaceApp ? [selectedWorkspaceApp.id] : [], onClick: onClose }} onClose={onClose} />;
}

export function workspaceFileRevealLabel(platform?: string, t: Translate = defaultTranslate): string {
  if (platform === 'darwin') return t('workspace.fileMenu.reveal.finder');
  if (platform === 'win32') return t('workspace.fileMenu.reveal.explorer');
  return t('workspace.fileMenu.reveal.folder');
}

function openInAppLabel(app: DesktopWorkspaceApp, line: number | undefined, t: Translate): string {
  const supportsLine = ['cursor', 'intellij-idea', 'pycharm', 'trae', 'vscode', 'webstorm'].includes(app.id);
  return line && supportsLine
    ? t('workspace.fileMenu.openLineInApp', { app: app.label, line })
    : t('workspace.fileMenu.openInApp', { app: app.label });
}
