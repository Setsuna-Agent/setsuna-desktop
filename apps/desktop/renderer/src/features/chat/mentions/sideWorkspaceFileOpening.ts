import type { DesktopOpenPathResult, DesktopWorkspaceApp, SetsunaDesktopBridge } from '@setsuna-desktop/contracts';
import { translate, type Translate } from '../../../shared/i18n/I18nProvider.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

type SideWorkspaceFileOpeningOptions = {
  filePath: string;
  line?: number;
  openInWorkspaceApp?: SetsunaDesktopBridge['workspaceApps']['open'];
  openWithDefaultApp?: (workspaceRoot: string, filePath: string) => Promise<DesktopOpenPathResult>;
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  t?: Translate;
  workspaceRoot: string;
};

type SideWorkspaceDirectoryOpeningOptions = {
  directoryPath: string;
  openDirectory?: SetsunaDesktopBridge['desktop']['openWorkspaceDirectory'];
  t?: Translate;
  workspaceRoot: string;
};

/** Open a side-chat file against that chat's root, not the main conversation's active workspace. */
export async function openSideWorkspaceFileAtRoot({
  filePath,
  line,
  openInWorkspaceApp,
  openWithDefaultApp,
  selectedWorkspaceApp,
  t = defaultTranslate,
  workspaceRoot,
}: SideWorkspaceFileOpeningOptions): Promise<string | null> {
  if (selectedWorkspaceApp) {
    if (!openInWorkspaceApp) return t('chat.mention.workspaceAppUnsupported');
    await openInWorkspaceApp(workspaceRoot, selectedWorkspaceApp.id, filePath, line ?? null);
    return null;
  }

  if (!openWithDefaultApp) return t('chat.mention.openUnsupported');
  const result = await openWithDefaultApp(workspaceRoot, filePath);
  return result.ok ? null : result.error;
}

/** Open a side-chat directory in the system file manager using that chat's own root. */
export async function openSideWorkspaceDirectoryAtRoot({
  directoryPath,
  openDirectory,
  t = defaultTranslate,
  workspaceRoot,
}: SideWorkspaceDirectoryOpeningOptions): Promise<string | null> {
  if (!openDirectory) return t('chat.mention.openDirectoryUnsupported');
  const result = await openDirectory(workspaceRoot, directoryPath);
  return result.ok ? null : result.error;
}
