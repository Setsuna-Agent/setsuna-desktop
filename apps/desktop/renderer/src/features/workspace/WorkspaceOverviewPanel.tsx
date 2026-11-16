import { workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button, Tooltip } from '@setsuna-desktop/renderer-ui';
import { Bug, ClipboardCheck, FolderOpen, GitBranch, Globe, PanelRight, SquareTerminal } from 'lucide-react';
import { useId, useRef } from 'react';
import { useToast } from '../../app/providers/ToastProvider.js';
import { BrowserQuickLinks, BrowserStartPageSearch } from '../../composition/BrowserWorkspaceFeatureBoundary.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { KeyboardShortcutCommandId } from '../../shared/shortcuts/keyboardShortcutCommands.js';
import { ShortcutTooltipContent } from '../../shared/ui/ShortcutTooltip.js';
import { ScrollOverlay } from '../../shared/ui/ScrollOverlay.js';

export function WorkspaceOverviewPanel({
  activeProject,
  isGitRepository,
  onOpenFilesPanel,
  onOpenBrowser,
  onOpenConversationDebug,
  onOpenReviewPanel,
  onOpenChangesPanel,
  onOpenSideChat,
  onOpenTerminalPanel,
}: {
  activeProject?: WorkspaceProject;
  isGitRepository: boolean;
  onOpenFilesPanel: () => void;
  onOpenBrowser: (url?: string) => void;
  onOpenConversationDebug?: () => void;
  onOpenReviewPanel?: () => void;
  onOpenChangesPanel?: () => void;
  onOpenSideChat: () => void;
  onOpenTerminalPanel: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const shortcutsHeadingId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  // Git status covers the primary directory; Changes lets multi-root projects select another repository.
  const showChanges = isGitRepository || workspaceProjectRoots(activeProject).length > 1;
  const actions: Array<{
    key: string;
    label: string;
    icon: JSX.Element;
    disabled: boolean;
    onClick: () => void;
    shortcutCommandId: KeyboardShortcutCommandId;
  }> = [
    {
      key: 'review',
      label: t('workspace.overview.review'),
      icon: <ClipboardCheck size={16} />,
      disabled: !activeProject || !onOpenReviewPanel,
      onClick: () => onOpenReviewPanel?.(),
      shortcutCommandId: 'workspace.openReview',
    },
    ...(showChanges ? [{
      key: 'changes',
      label: t('workspace.panel.changes'),
      icon: <GitBranch size={16} />,
      disabled: !activeProject?.path || !onOpenChangesPanel,
      onClick: () => onOpenChangesPanel?.(),
      shortcutCommandId: 'workspace.openChanges' as const,
    }] : []),
    {
      key: 'files',
      label: t('workspace.overview.files'),
      icon: <FolderOpen size={16} />,
      disabled: !activeProject?.path,
      onClick: onOpenFilesPanel,
      shortcutCommandId: 'workspace.openFiles',
    },
    {
      key: 'terminal',
      label: t('workspace.overview.terminal'),
      icon: <SquareTerminal size={16} />,
      disabled: !activeProject?.path,
      onClick: onOpenTerminalPanel,
      shortcutCommandId: 'workspace.openTerminal',
    },
    {
      key: 'side-chat',
      label: t('workspace.overview.sideChat'),
      icon: <PanelRight size={16} />,
      disabled: false,
      onClick: onOpenSideChat,
      shortcutCommandId: 'workspace.openSideChat',
    },
    {
      key: 'browser',
      label: t('workspace.overview.browser'),
      icon: <Globe size={16} />,
      disabled: false,
      onClick: () => onOpenBrowser(),
      shortcutCommandId: 'workspace.openBrowser',
    },
    ...(onOpenConversationDebug ? [{
      key: 'conversation-debug',
      label: t('workspace.overview.conversationDebug'),
      icon: <Bug size={16} />,
      disabled: false,
      onClick: onOpenConversationDebug,
      shortcutCommandId: 'workspace.openConversationDebug' as const,
    }] : []),
  ];

  return (
    <section className="desktop-workspace-overview" aria-label={t('workspace.overview.label')}>
      <div ref={viewportRef} className="desktop-workspace-overview__viewport">
        <div className="desktop-workspace-overview__content">
          <header className="desktop-workspace-overview__header">
            <BrowserStartPageSearch bridge={window.setsunaDesktop?.browser ?? null} onNavigate={onOpenBrowser}
              onError={toast.error} translate={t} />
          </header>
          <section aria-labelledby={shortcutsHeadingId}>
            <h2 id={shortcutsHeadingId} className="desktop-workspace-overview__section-title">
              {t('workspace.overview.shortcuts')}
            </h2>
            <div className="desktop-workspace-overview__actions">
              {actions.map((action) => (
                <Tooltip key={action.key} title={<ShortcutTooltipContent commandId={action.shortcutCommandId} label={action.label} />}>
                  <Button variant="ghost"
                    className="desktop-workspace-overview__action"
                    data-workspace-overview-action={action.key}
                    disabled={action.disabled}
                    type="button"
                    onClick={action.onClick}
                  >
                    <span className="desktop-workspace-overview__action-icon" aria-hidden="true">{action.icon}</span>
                    <span className="desktop-workspace-overview__action-label">{action.label}</span>
                  </Button>
                </Tooltip>
              ))}
            </div>
          </section>
          <BrowserQuickLinks onNavigate={onOpenBrowser} onError={toast.error} translate={t}
            getWebsiteFavicon={window.setsunaDesktop?.browser.getWebsiteFavicon} />
        </div>
      </div>
      <ScrollOverlay scrollRef={viewportRef} />
    </section>
  );
}
