import { resolveWorkspaceFileReference, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { useCallback } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { DesktopWorkspaceApp } from '../model.js';

export function useWorkspaceFileActions(
  activeProject: WorkspaceProject | null | undefined,
  workspaceApps: DesktopWorkspaceApp[],
  selectedWorkspaceApp: DesktopWorkspaceApp | null,
  setError: (message: string | null) => void,
) {
  const { t } = useI18n();
  const openFileWithWorkspaceApp = useCallback(
    async (appId: string, filePath?: string | null, line?: number) => {
      if (!activeProject?.path) return;
      if (!workspaceApps.some((app) => app.id === appId)) {
        setError(t('workspace.panels.appUnavailable'));
        return;
      }
      try {
        const api = window.setsunaDesktop?.workspaceApps;
        if (!api) throw new Error(t('workspace.panels.externalOpenUnsupported'));
        const target = resolveFileTarget(activeProject, filePath ?? '.');
        await api.open(target.root.path, appId, filePath == null ? null : target.path, line ?? null);
      } catch (unknownError) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    },
    [activeProject, setError, t, workspaceApps],
  );

  const openFileInWorkspaceApp = useCallback(
    async (filePath?: string | null, line?: number) => {
      if (!selectedWorkspaceApp) return;
      await openFileWithWorkspaceApp(selectedWorkspaceApp.id, filePath, line);
    },
    [openFileWithWorkspaceApp, selectedWorkspaceApp],
  );

  const copyWorkspaceFilePath = useCallback(async (filePath: string) => {
    if (!activeProject?.path) return;
    const api = window.setsunaDesktop?.desktop;
    if (!api) {
      setError(t('workspace.panels.copyPathUnsupported'));
      return;
    }
    try {
      const target = resolveFileTarget(activeProject, filePath);
      const result = await api.copyWorkspaceFilePath(target.root.path, target.path);
      if (!result.ok) setError(result.error);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, [activeProject, setError, t]);

  const openWorkspaceDirectory = useCallback(async (directoryPath: string) => {
    if (!activeProject?.path) return;
    const openDirectory = window.setsunaDesktop?.desktop?.openWorkspaceDirectory;
    if (!openDirectory) {
      setError(t('chat.mention.openDirectoryUnsupported'));
      return;
    }
    try {
      const target = resolveFileTarget(activeProject, directoryPath);
      const result = await openDirectory(target.root.path, target.path);
      if (!result.ok) setError(result.error);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, [activeProject, setError, t]);

  const revealWorkspaceFile = useCallback(async (filePath: string) => {
    if (!activeProject?.path) return;
    const api = window.setsunaDesktop?.desktop;
    if (!api) {
      setError(t('workspace.panels.revealUnsupported'));
      return;
    }
    try {
      const target = resolveFileTarget(activeProject, filePath);
      const result = await api.revealWorkspaceFile(target.root.path, target.path);
      if (!result.ok) setError(result.error);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, [activeProject, setError, t]);

  return { copyWorkspaceFilePath, openFileInWorkspaceApp, openFileWithWorkspaceApp, openWorkspaceDirectory, revealWorkspaceFile };
}

function resolveFileTarget(project: WorkspaceProject, filePath: string) {
  // Native bridges accept a trusted root and a relative path, even when UI routing uses absolute references.
  const target = resolveWorkspaceFileReference(project, filePath);
  if (!target) throw new Error('File path must stay inside the workspace.');
  return target;
}
