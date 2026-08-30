import { Bug, FileDiff, FileText, FolderOpen, MessageSquare, PanelRight, Terminal, Users } from 'lucide-react';
import { BrowserFavicon as BrowserFeatureFavicon } from '../../composition/BrowserWorkspaceFeatureBoundary.js';
import { translate, type Translate } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import { fileName, type DesktopPanelTab, type DesktopPanelType } from './model.js';
import { WorkspaceFileIcon } from './WorkspaceFileIcon.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);
const sideChatKnownTitles = ['侧边任务', '侧边对话', 'Side task', 'Side chat'] as const;
const sideChatNumberedTitlePattern = /^(?:侧边任务|侧边对话|Side task|Side chat) ([1-9]\d*)$/u;

const panelTitleCopy: Partial<Record<DesktopPanelType, { key: MessageKey; knownTitles: readonly string[] }>> = {
  overview: { key: 'workspace.panel.overview', knownTitles: ['汇总目录'] },
  // Normalize tabs opened before the copy change as well as tabs created in either locale.
  chat: { key: 'workspace.panel.sideChat', knownTitles: sideChatKnownTitles },
  'conversation-debug': { key: 'workspace.panel.conversationDebug', knownTitles: ['对话调试'] },
  browser: { key: 'workspace.panel.newTab', knownTitles: ['新标签页'] },
  review: { key: 'workspace.panel.review', knownTitles: ['审查'] },
  terminal: { key: 'workspace.panel.terminal', knownTitles: ['终端'] },
  files: { key: 'workspace.panel.openFile', knownTitles: ['打开文件'] },
};

export function desktopPanelTitle(panel: DesktopPanelTab, t: Translate = defaultTranslate): string {
  if (panel.type === 'file' && panel.filePath) return fileName(panel.filePath);
  if (panel.type === 'chat' && panel.title) {
    const numberedTitle = sideChatNumberedTitlePattern.exec(panel.title);
    if (numberedTitle?.[1]) return t('workspace.panels.sideChatNumbered', { sequence: numberedTitle[1] });
  }
  const copy = panelTitleCopy[panel.type];
  if (copy && (!panel.title || copy.knownTitles.includes(panel.title))) return t(copy.key);
  return panel.title || t('workspace.panel.openFile');
}

export function DesktopPanelIcon({ panel, type }: { panel?: DesktopPanelTab; type?: DesktopPanelType }) {
  const panelType = panel?.type ?? type;
  if (panel?.type === 'file') {
    return <WorkspaceFileIcon className="chat-file-review-panel__tab-file-icon" path={panel.filePath ?? panel.title ?? ''} type="file" />;
  }
  if (panelType === 'overview') return <PanelRight size={14} />;
  if (panelType === 'chat') return <MessageSquare size={14} />;
  if (panelType === 'subagent') return <Users size={14} />;
  if (panelType === 'conversation-debug') return <Bug size={14} />;
  if (panelType === 'browser') {
    return <BrowserFeatureFavicon faviconUrl={panel?.browser?.faviconUrl ?? null} loading={panel?.browser?.loading ?? false} />;
  }
  if (panelType === 'terminal') return <Terminal size={14} />;
  if (panelType === 'review') return <FileDiff size={14} />;
  if (panelType === 'file') return <FileText size={14} />;
  return <FolderOpen size={14} />;
}
