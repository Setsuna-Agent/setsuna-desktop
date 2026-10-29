import { IconButton } from '@setsuna-desktop/renderer-ui';
import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimePluginSummary,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import type { CollaborationTask } from '@setsuna-desktop/feature-collaboration/contracts';
import {
  CollaborationFeatureTaskStatus,
  CollaborationFeatureTaskControls,
  CollaborationFeatureAgentInfo,
  useCollaborationFeatureState,
} from '../../composition/CollaborationFeatureBoundary.js';
import { ArrowLeft, X } from 'lucide-react';
import { useRef, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { BrandIconMark } from '../../shared/branding/BrandIconMark.js';
import { resolveModelBrand } from '../../shared/branding/providerBranding.js';
import type { DesktopReviewOpenHandler } from '../workspace/model.js';
import { useThreadMessageHistory } from './hooks/useThreadMessageHistory.js';
import { useObservedRuntimeThread } from './hooks/useObservedRuntimeThread.js';
import { MarkdownNavigationProvider } from './markdown/MarkdownNavigationProvider.js';
import type { SearchMarkdownWorkspaceEntries } from './markdown/useMarkdownWorkspaceFiles.js';
import { ChatTranscript } from './conversation/ChatTranscript.js';
import { chatExecutionModelSelection } from './chatModelSelection.js';

/**
 * 子代理实时转录与执行控制。任务指令统一从主对话补充，关闭面板不影响执行。
 */
export function SubagentConversationPanel({
  childThreadId,
  client,
  config,
  initialDisplayName,
  parentThreadId,
  plugins,
  skills,
  workspaceRoot,
  onBack,
  onClose,
  onError,
  onOpenFileReview,
  onOpenMarkdownWebLink,
  onOpenInAppBrowser,
  onSearchWorkspaceEntries,
}: {
  childThreadId: string;
  client: DesktopRuntimeClient;
  config: RuntimeConfigState | null;
  initialDisplayName: string;
  parentThreadId: string;
  plugins: RuntimePluginSummary[];
  skills: RuntimeSkillSummary[];
  workspaceRoot?: string;
  onBack: () => void;
  onClose: () => void;
  onError: Dispatch<SetStateAction<string | null>>;
  onOpenFileReview?: DesktopReviewOpenHandler;
  onOpenMarkdownWebLink: (url: string) => void;
  onOpenInAppBrowser: (url: string) => void;
  onSearchWorkspaceEntries?: SearchMarkdownWorkspaceEntries;
}) {
  const { t } = useI18n();
  const child = useObservedRuntimeThread({
    client,
    onError,
    threadId: childThreadId,
  });
  const collaboration = useCollaborationFeatureState(parentThreadId);
  const task = collaboration.state.tasks.find((candidate) => candidate.childThreadId === childThreadId)
    ?? fallbackTask(childThreadId, initialDisplayName, child.currentThread?.title, t);
  const messageHistory = useThreadMessageHistory(client, child.currentThread);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const executionModel = chatExecutionModelSelection(config, child.currentThread, child.activeTurnId, task.configuration?.modelBinding);
  const modelLabel = executionModel?.model?.name || executionModel?.fallbackModelCode;
  const modelBrand = modelLabel ? resolveModelBrand(
    executionModel?.model ?? { name: modelLabel, code: executionModel?.fallbackModelCode ?? modelLabel },
    executionModel?.provider ?? { name: '', baseUrl: '' },
  ) : null;

  return (
    <MarkdownNavigationProvider
      onOpenInAppBrowser={onOpenInAppBrowser}
      onOpenWebLink={onOpenMarkdownWebLink}
      workspaceRoot={workspaceRoot}
      onSearchWorkspaceEntries={onSearchWorkspaceEntries}
      onOpenWorkspaceFile={(filePath, line) => {
        onOpenFileReview?.(filePath, line);
      }}
    >
      <SubagentHeader
        task={task}
        title={child.currentThread?.title}
        agentInfo={<CollaborationFeatureAgentInfo configuration={task.configuration} identity={task.identity}
          modelLabel={modelLabel}
          modelIcon={modelLabel ? <BrandIconMark brand={modelBrand} fallbackName={modelLabel} size="compact" /> : undefined}
          translate={t} />}
        onBack={onBack}
        onClose={onClose}
        taskControls={<CollaborationFeatureTaskControls parentThreadId={parentThreadId} childThreadId={childThreadId}
          activeTurnId={child.activeTurnId} translate={t} onError={onError} />}
      />
      <ChatTranscript
        activeTurnId={child.activeTurnId}
        contextCompactionRunning={Boolean(child.currentThread?.contextCompaction?.status === 'running')}
        contentRef={contentRef}
        currentThread={child.currentThread}
        messageHistory={messageHistory}
        messages={messageHistory.messages}
        plugins={plugins}
        readOnly
        showThinkingInTranscript={config?.desktopSettings?.showThinkingInTranscript === true}
        skills={skills}
        onAnswerApproval={child.answerApproval}
        onOpenFileReview={onOpenFileReview}
      />
    </MarkdownNavigationProvider>
  );
}

function SubagentHeader({
  agentInfo,
  onBack,
  onClose,
  task,
  taskControls,
  title,
}: {
  agentInfo: ReactNode;
  onBack: () => void;
  onClose: () => void;
  task: CollaborationTask;
  taskControls: ReactNode;
  title?: string;
}) {
  const { t } = useI18n();
  return (
    <header className="subagent-panel-header">
      <IconButton className="subagent-panel-header__back" label={t('feature.collaboration.panel.backToList')} onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
      </IconButton>
      <div className="subagent-panel-header__text">
        <div className="subagent-panel-header__name-row">
          <strong className="subagent-panel-header__name">{task.identity.displayName}</strong>
          <CollaborationFeatureTaskStatus status={task.status} translate={t} />
          {agentInfo}
        </div>
        <div className="subagent-panel-header__title" title={title ?? task.title}>
          {title ?? task.title}
        </div>
      </div>
      <div className="subagent-panel-header__actions">
        {taskControls}
        <IconButton
          className="subagent-panel-header__close"
          label={t('feature.collaboration.panel.close')}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  );
}

function fallbackTask(
  childThreadId: string,
  initialDisplayName: string,
  title: string | undefined,
  translate: ReturnType<typeof useI18n>['t'],
): CollaborationTask {
  const displayName = initialDisplayName.trim()
    || translate('feature.collaboration.card.unnamedAgent');
  return {
    id: `task:${childThreadId}`,
    childThreadId,
    title: title ?? '',
    objective: '',
    identity: { displayName, avatarSeed: childThreadId },
    status: 'running',
    createdAt: '',
    updatedAt: '',
  };
}
