import { workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button } from '@setsuna-desktop/renderer-ui';
import { Bug, FileDiff, FolderOpen, GitBranch, LayoutGrid, MessageSquare, SquareTerminal } from 'lucide-react';
import { useId, type CSSProperties } from 'react';
import { useToast } from '../../app/providers/ToastProvider.js';
import { BrowserFeatureIcon, BrowserQuickLinks } from '../../composition/BrowserWorkspaceFeatureBoundary.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { KeyboardShortcutCommandId } from '../../shared/shortcuts/keyboardShortcutCommands.js';
import { ShortcutHint } from '../../shared/ui/ShortcutTooltip.js';
import { useWorkspaceBackground } from './overview/useWorkspaceBackground.js';
import { useWorkspaceHeaderVisibility } from './overview/useWorkspaceHeaderVisibility.js';
import { WorkspaceOverviewHeader } from './overview/WorkspaceOverviewHeader.js';
import { WorkspaceOverviewSettings } from './overview/WorkspaceOverviewSettings.js';

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
  const background = useWorkspaceBackground((reason) => {
    toast.error(t(reason === 'invalid' ? 'workspace.overview.background.invalid' : 'workspace.overview.background.failed'));
  });
  const { headerVisible, setHeaderVisible } = useWorkspaceHeaderVisibility(() => {
    toast.error(t('workspace.overview.settingsFailed'));
  });
  // Git status covers the primary directory; Changes lets multi-root projects select another repository.
  const showChanges = isGitRepository || workspaceProjectRoots(activeProject).length > 1;
  const actions: Array<{
    key: string;
    label: string;
    icon: JSX.Element;
    disabled: boolean;
    onClick: () => void;
    shortcutCommandId?: KeyboardShortcutCommandId;
  }> = [
    {
      key: 'review',
      label: t('workspace.overview.review'),
      icon: <FileDiff size={15} />,
      disabled: !activeProject || !onOpenReviewPanel,
      onClick: () => onOpenReviewPanel?.(),
      shortcutCommandId: 'workspace.openReview',
    },
    ...(showChanges ? [{
      key: 'changes',
      label: t('workspace.panel.changes'),
      icon: <GitBranch size={15} />,
      disabled: !activeProject?.path || !onOpenChangesPanel,
      onClick: () => onOpenChangesPanel?.(),
      shortcutCommandId: 'workspace.openChanges' as const,
    }] : []),
    {
      key: 'files',
      label: t('workspace.overview.files'),
      icon: <FolderOpen size={15} />,
      disabled: !activeProject?.path,
      onClick: onOpenFilesPanel,
      shortcutCommandId: 'workspace.openFiles',
    },
    {
      key: 'terminal',
      label: t('workspace.overview.terminal'),
      icon: <SquareTerminal size={15} />,
      disabled: !activeProject?.path,
      onClick: onOpenTerminalPanel,
      shortcutCommandId: 'workspace.openTerminal',
    },
    {
      key: 'side-chat',
      label: t('workspace.overview.sideChat'),
      icon: <MessageSquare size={15} />,
      disabled: false,
      onClick: onOpenSideChat,
      shortcutCommandId: 'workspace.openSideChat',
    },
    {
      key: 'browser',
      label: t('workspace.overview.browser'),
      icon: <BrowserFeatureIcon size={15} />,
      disabled: false,
      onClick: () => onOpenBrowser(),
      shortcutCommandId: 'workspace.openBrowser',
    },
    ...(onOpenConversationDebug ? [{
      key: 'conversation-debug',
      label: t('workspace.overview.conversationDebug'),
      icon: <Bug size={15} />,
      disabled: false,
      onClick: onOpenConversationDebug,
      shortcutCommandId: 'workspace.openConversationDebug' as const,
    }] : []),
  ];

  return (
    <section className="desktop-workspace-overview" aria-label={t('workspace.overview.label')}
      data-has-background={background.url ? true : undefined}
      style={background.url ? {
        '--workspace-overview-background': `url("${background.url}")`,
        '--workspace-overview-background-transparency': `${background.transparency}%`,
      } as CSSProperties : undefined}>
      <WorkspaceOverviewSettings hasImage={Boolean(background.url)} busy={background.busy}
        headerVisible={headerVisible} onHeaderVisibleChange={setHeaderVisible}
        transparency={background.transparency} onTransparencyChange={background.setTransparency} onChange={background.change} />
      <div className="desktop-workspace-overview__content">
        {headerVisible ? <WorkspaceOverviewHeader onNavigate={onOpenBrowser} /> : null}
        <section aria-labelledby={shortcutsHeadingId}>
          <h2 id={shortcutsHeadingId} className="desktop-workspace-overview__section-title">
            <LayoutGrid size={14} aria-hidden="true" />{t('workspace.overview.shortcuts')}
          </h2>
          <div className="desktop-workspace-overview__actions">
            {actions.map((action) => (
              <Button variant="ghost"
                className="desktop-workspace-overview__action"
                data-workspace-overview-action={action.key}
                disabled={action.disabled}
                key={action.key}
                type="button"
                onClick={action.onClick}
              >
                <span className="desktop-workspace-overview__action-icon">{action.icon}</span>
                <span className="desktop-workspace-overview__action-label">{action.label}</span>
                {action.shortcutCommandId ? <ShortcutHint
                  className="desktop-workspace-overview__action-shortcut"
                  commandId={action.shortcutCommandId}
                /> : null}
              </Button>
            ))}
          </div>
        </section>
        <BrowserQuickLinks onNavigate={onOpenBrowser} onError={toast.error} translate={t}
          getWebsiteFavicon={window.setsunaDesktop?.browser.getWebsiteFavicon} />
      </div>
    </section>
  );
}
