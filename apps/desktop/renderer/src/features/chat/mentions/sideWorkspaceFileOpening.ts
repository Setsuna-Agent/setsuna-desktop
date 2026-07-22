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
