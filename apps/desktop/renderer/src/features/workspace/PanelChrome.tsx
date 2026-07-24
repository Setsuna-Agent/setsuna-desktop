import { Bug, Code2, FileText, FolderOpen, MessageSquare, PanelRight, Terminal } from 'lucide-react';
import { translate, type Translate } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import { BrowserFavicon } from './BrowserFavicon.js';
import { fileName, type DesktopPanelTab, type DesktopPanelType, type DesktopWorkspaceApp } from './model.js';
import { workspaceAppIconAssets } from './workspaceAppIcons.js';
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
  if (panelType === 'conversation-debug') return <Bug size={14} />;
  if (panelType === 'browser') {
    return <BrowserFavicon faviconUrl={panel?.browser?.faviconUrl ?? null} loading={panel?.browser?.loading ?? false} />;
  }
  if (panelType === 'terminal') return <Terminal size={14} />;
  if (panelType === 'review' || panelType === 'file') return <FileText size={14} />;
  return <FolderOpen size={14} />;
}

export function WorkspaceAppGlyph({ app }: { app: DesktopWorkspaceApp | null }) {
  const icon = app?.icon || app?.id || 'app';
  const iconAsset = workspaceAppIconAssets[icon];
  return (
    <span
      className={`desktop-workspace-launcher__glyph desktop-workspace-launcher__glyph--${icon} ${iconAsset?.monochrome ? 'desktop-workspace-launcher__glyph--monochrome' : ''}`}
      aria-hidden="true"
    >
      {iconAsset ? <img src={iconAsset.src} alt="" draggable={false} /> : workspaceAppSystemIcon(icon)}
    </span>
  );
}

function workspaceAppSystemIcon(icon: string) {
  if (icon === 'antigravity') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.8 21 19.5H3L12 2.8Z" fill="#4285f4" />
        <path d="M12 2.8 16.6 11.3 12 19.5 7.4 11.3 12 2.8Z" fill="#34a853" />
        <path d="M3 19.5 7.4 11.3 12 19.5H3Z" fill="#fbbc04" />
        <path d="M21 19.5h-9l4.6-8.2L21 19.5Z" fill="#ea4335" />
      </svg>
    );
  }
  if (icon === 'trae') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="#111827" />
        <path d="M7 8h10M12 8v8M8.2 16h7.6" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 6.8 19 5v4l-2-2.2Z" fill="#22c55e" />
      </svg>
    );
  }
  if (icon === 'fleet') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="#6d28d9" />
        <path d="M7 7h10v3H10v2h6v3h-6v3H7V7Z" fill="#ffffff" />
        <path d="M16 7h1v11h-1z" fill="#22d3ee" />
      </svg>
    );
  }
  if (icon === 'rustrover') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="#111111" />
        <path d="M7 16V8h4.4c1.8 0 3 1 3 2.6 0 1.1-.6 1.9-1.5 2.3L16 16h-3l-2.5-2.8H9.6V16H7Z" fill="#ffffff" />
        <path d="M9.6 10.1v1.3H11c.5 0 .8-.2.8-.7s-.3-.6-.8-.6H9.6Z" fill="#111111" />
        <path d="M16.2 7.2 18.5 10l-2.3 2.8" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (icon === 'finder') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="#dff0ff" />
        <path d="M12 3h4.2A4.8 4.8 0 0 1 21 7.8v8.4a4.8 4.8 0 0 1-4.8 4.8H12V3Z" fill="#6fb1ff" />
        <path d="M12 3v18" stroke="#2e6fbd" strokeWidth="1.2" />
        <path d="M7.2 9.2h.1M16.7 9.2h.1" stroke="#12385f" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8.2 15.3c2.4 1.6 5.2 1.6 7.6 0" stroke="#12385f" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (icon === 'explorer') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h4.2l2 2H19a2 2 0 0 1 2 2v1.2H3v-3Z" fill="#f7c948" />
        <path d="M3.2 9h17.6l-1.3 8.6A2.4 2.4 0 0 1 17.1 20H6.9a2.4 2.4 0 0 1-2.4-2.4L3.2 9Z" fill="#f4b740" />
        <path d="M5 10.4h14" stroke="#fff4c4" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (icon === 'terminal') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="4" fill="#2f3437" />
        <path d="m7 9 3 3-3 3" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.2 15h4.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return <Code2 size={15} />;
}
