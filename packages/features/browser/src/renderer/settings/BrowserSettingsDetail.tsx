import { BrowserHistoryPage } from './BrowserHistoryPage.js';
import { BrowserRecordsManager } from '../records/BrowserRecordsManager.js';
import { BrowserPasswordManager } from './BrowserPasswordManager.js';
import { BrowserSitePermissions } from './BrowserSitePermissions.js';
import { BrowserExtensionManager } from './BrowserExtensionManager.js';
import { BrowserImportPage } from './BrowserImportPage.js';
import { useBrowserSettingsNavigation } from './context.js';
import type { BrowserSettingsContentProps } from './types.js';

const detailTitles = {
  history: 'feature.browser.settings.history', bookmarks: 'feature.browser.settings.bookmarks',
  passwords: 'feature.browser.settings.passwords', permissions: 'feature.browser.settings.sitePermissions',
  extensions: 'feature.browser.extension.label',
  import: 'feature.browser.import.title',
} as const;
export type BrowserSettingsDetailKind = keyof typeof detailTitles;

export function BrowserSettingsDetail({ kind, onBack, ...props }: BrowserSettingsContentProps & {
  kind: BrowserSettingsDetailKind; onBack(): void;
}) {
  const navigation = useBrowserSettingsNavigation();
  const { ui } = props;
  return <ui.PageLayout title={props.translate(detailTitles[kind])} parent={{ label: props.translate('feature.browser.settings.title'), onBack }}>
    {kind === 'history' ? <BrowserHistoryPage translate={props.translate} ui={props.ui} onNavigate={navigation?.openPage} /> : null}
    {kind === 'bookmarks' ? <BrowserRecordsManager kind="bookmarks" presentation="page" translate={props.translate} onClose={onBack} onNavigate={navigation?.openPage} /> : null}
    {kind === 'passwords' ? <BrowserPasswordManager {...props} /> : null}
    {kind === 'permissions' ? <BrowserSitePermissions {...props} /> : null}
    {kind === 'extensions' ? <BrowserExtensionManager {...props} /> : null}
    {kind === 'import' ? <BrowserImportPage {...props} /> : null}
  </ui.PageLayout>;
}
