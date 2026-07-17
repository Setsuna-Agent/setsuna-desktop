import type { DesktopOpenPathResult, DesktopWorkspaceApp, SetsunaDesktopBridge } from '@setsuna-desktop/contracts';

type SideWorkspaceFileOpeningOptions = {
  filePath: string;
  line?: number;
  openInWorkspaceApp?: SetsunaDesktopBridge['workspaceApps']['open'];
  openWithDefaultApp?: (workspaceRoot: string, filePath: string) => Promise<DesktopOpenPathResult>;
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  workspaceRoot: string;
};

/** Open a side-chat file against that chat's root, not the main conversation's active workspace. */
export async function openSideWorkspaceFileAtRoot({
  filePath,
  line,
  openInWorkspaceApp,
  openWithDefaultApp,
  selectedWorkspaceApp,
  workspaceRoot,
}: SideWorkspaceFileOpeningOptions): Promise<string | null> {
  if (selectedWorkspaceApp) {
    if (!openInWorkspaceApp) return '当前环境不支持使用工作区应用打开文件。';
    await openInWorkspaceApp(workspaceRoot, selectedWorkspaceApp.id, filePath, line ?? null);
    return null;
  }

  if (!openWithDefaultApp) return '当前环境不支持打开工作区文件。';
  const result = await openWithDefaultApp(workspaceRoot, filePath);
  return result.ok ? null : result.error;
}
