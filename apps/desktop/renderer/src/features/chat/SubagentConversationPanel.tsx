import type {
  DesktopRuntimeClient,
  RuntimeCollaborationTask,
  RuntimeConfigState,
  RuntimePluginSummary,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import { X } from 'lucide-react';
import { useCallback, useRef, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { DesktopReviewOpenHandler, DesktopPanelSlot } from '../workspace/model.js';
import { WorkspaceResizeHandle } from '../workspace/WorkspaceResizeHandle.js';
import { useThreadMessageHistory } from './hooks/useThreadMessageHistory.js';
import { useObservedRuntimeThread } from './hooks/useObservedRuntimeThread.js';
import { MarkdownNavigationProvider } from './markdown/MarkdownNavigationProvider.js';
import { ChatTranscript } from './conversation/ChatTranscript.js';
import { AgentAvatar } from './subagents/AgentAvatar.js';
import { SubagentTaskStatus } from './subagents/SubagentTaskStatus.js';

/**
 * 子代理只读面板：观察 child 线程的实时转录，并从父线程任务账本读取身份与状态。
 * 没有输入框、编辑、重新生成或删除入口；关闭面板不会停止或删除 Agent。
 */
export function SubagentConversationPanel({
  childThreadId,
  client,
  config,
  hidden,
  initialTask,
  parentThreadId,
  placement = 'side',
  plugins,
  skills,
  workspaceRoot,
  onClose,
  onError,
  onOpenFileReview,
  onOpenMarkdownWebLink,
  onOpenInAppBrowser,
  onResizeStep,
  onResizeStart,
  workspaceMaxWidth,
  workspaceMinWidth,
  workspaceWidth,
}: {
  childThreadId: string;
  client: DesktopRuntimeClient;
  config: RuntimeConfigState | null;
  hidden: boolean;
  initialTask: RuntimeCollaborationTask;
  parentThreadId: string;
  placement?: DesktopPanelSlot;
  plugins: RuntimePluginSummary[];
  skills: RuntimeSkillSummary[];
  workspaceRoot?: string;
  onClose: () => void;
  onError: Dispatch<SetStateAction<string | null>>;
  onOpenFileReview?: DesktopReviewOpenHandler;
  onOpenMarkdownWebLink: (url: string) => void;
  onOpenInAppBrowser: (url: string) => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  workspaceMaxWidth: number;
  workspaceMinWidth: number;
  workspaceWidth: number;
}) {
  const { t } = useI18n();
  const child = useObservedRuntimeThread({
    client,
    onError,
    threadId: childThreadId,
  });
  const parent = useObservedRuntimeThread({
    client,
    threadId: parentThreadId,
  });
  // 任务账本以父线程为准；父线程删除后回退到面板打开时的快照。
  const task = parent.currentThread?.collaborationTasks
    ?.find((candidate) => candidate.childThreadId === childThreadId)
    ?? initialTask;
  const messageHistory = useThreadMessageHistory(client, child.currentThread);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const cancelActiveTurn = useCallback(() => {
    const activeTurnId = child.activeTurnId;
    if (!activeTurnId) return;
    void client.cancelTurn(childThreadId, activeTurnId).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    });
  }, [child.activeTurnId, childThreadId, client, onError]);

  return (
    <aside
      className={`desktop-workspace-panel desktop-subagent-panel${placement === 'bottom' ? ' desktop-workspace-panel--bottom-floating' : ''}`}
      aria-label={t('subagent.panel.label')}
      hidden={hidden}
    >
      {placement === 'side' ? (
        <WorkspaceResizeHandle
          max={workspaceMaxWidth}
          min={workspaceMinWidth}
          value={workspaceWidth}
          onResizeStart={onResizeStart}
          onResizeStep={onResizeStep}
        />
      ) : null}
      <MarkdownNavigationProvider
        onOpenInAppBrowser={onOpenInAppBrowser}
        onOpenWebLink={onOpenMarkdownWebLink}
        workspaceRoot={workspaceRoot}
        onOpenWorkspaceFile={(filePath, line) => {
          onOpenFileReview?.(filePath, line);
        }}
      >
        <SubagentHeader
          task={task}
          title={child.currentThread?.title}
          activeTurnId={child.activeTurnId}
          onCancel={cancelActiveTurn}
          onClose={onClose}
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
    </aside>
  );
}

function SubagentHeader({
  activeTurnId,
  onCancel,
  onClose,
  task,
  title,
}: {
  activeTurnId: string | null;
  onCancel: () => void;
  onClose: () => void;
  task: RuntimeCollaborationTask;
  title?: string;
}) {
  const { t } = useI18n();
  return (
    <header className="subagent-panel-header">
      <div className="subagent-panel-header__identity">
        <AgentAvatar identity={task.identity} size={32} />
        <div className="subagent-panel-header__text">
          <div className="subagent-panel-header__name-row">
            <strong className="subagent-panel-header__name">{task.identity.displayName}</strong>
            <SubagentTaskStatus status={task.status} />
          </div>
          <div className="subagent-panel-header__title" title={title ?? task.title}>
            {title ?? task.title}
          </div>
        </div>
      </div>
      <div className="subagent-panel-header__actions">
        {activeTurnId ? (
          <button type="button" className="subagent-panel-header__cancel" onClick={onCancel}>
            {t('subagent.panel.cancelTurn')}
          </button>
        ) : null}
        <button
          type="button"
          className="subagent-panel-header__close"
          aria-label={t('subagent.panel.close')}
          title={t('subagent.panel.close')}
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
