import { Button } from '@setsuna-desktop/renderer-ui';
import type { RuntimePluginSummary, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import type { ReviewConflictTaskProgressProps } from '@setsuna-desktop/feature-review/renderer/host';
import { ArrowLeft, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ChatTranscript } from '../features/chat/conversation/ChatTranscript.js';
import { useObservedRuntimeThread } from '../features/chat/hooks/useObservedRuntimeThread.js';
import { useThreadMessageHistory } from '../features/chat/hooks/useThreadMessageHistory.js';
import { MarkdownNavigationProvider } from '../features/chat/markdown/MarkdownNavigationProvider.js';
import { createDesktopRuntimeClient } from '../services/runtime-client/client.js';
import { useI18n } from '../shared/i18n/I18nProvider.js';

const noPlugins: RuntimePluginSummary[] = [];
const noSkills: RuntimeSkillSummary[] = [];

/** Review owns the task selection; the host reuses normal event, tool and approval UI. */
export function ReviewConflictTaskProgress({ threadId, turnId, workspaceRoot, onBack, onFinished, onOpenWorkspaceFile }: ReviewConflictTaskProgressProps) {
  const { t } = useI18n();
  const [client] = useState(createDesktopRuntimeClient);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const task = useObservedRuntimeThread({ client, threadId, onError: setError });
  const history = useThreadMessageHistory(client, task.currentThread);
  const contentRef = useRef<HTMLDivElement>(null);
  const notified = useRef<string | null>(null);
  const status = task.currentThread?.turns?.find((turn) => turn.id === turnId)?.status;
  const ended = status === 'completed' || status === 'cancelled' || status === 'failed';
  useEffect(() => {
    if (!ended || notified.current === turnId) return;
    notified.current = turnId;
    onFinished();
  }, [ended, onFinished, turnId]);
  const stop = async () => {
    setStopping(true);
    setError(null);
    try { await client.cancelTurn(threadId, turnId); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setStopping(false); }
  };
  const statusLabel = status === 'completed' ? t('feature.review.git.conflictFinished')
    : status === 'cancelled' ? t('feature.review.git.conflictStopped')
      : status === 'failed' ? t('feature.review.git.conflictFailed') : null;

  return (
    <div className="git-history-diff git-conflict-task">
      <header className="desktop-review-panel__toolbar">
        <div className="git-history-diff__heading">
          <Button variant="ghost" type="button" className="app-shell-icon-control" aria-label={t('feature.review.git.conflictBack')} onClick={onBack}><ArrowLeft size={14} /></Button>
          <span className="git-history-diff__title">{t('feature.review.git.conflictSection')}</span>
          {statusLabel ? <span className="git-conflict-task__status" role="status">{statusLabel}</span> : null}
        </div>
        {!ended ? <Button variant="ghost" type="button" disabled={stopping} onClick={() => void stop()}><Square size={12} />{t('feature.review.git.conflictStop')}</Button> : null}
      </header>
      {error ? <p className="git-history-status is-error" role="alert">{error}</p> : null}
      <MarkdownNavigationProvider workspaceRoot={workspaceRoot} onOpenWorkspaceFile={onOpenWorkspaceFile}>
        <ChatTranscript
          activeTurnId={task.activeTurnId}
          contextCompactionRunning={task.currentThread?.contextCompaction?.status === 'running'}
          contentRef={contentRef}
          currentThread={task.currentThread}
          messageHistory={history}
          messages={history.messages}
          plugins={noPlugins}
          skills={noSkills}
          readOnly
          showThinkingInTranscript={false}
          onAnswerApproval={task.answerApproval}
        />
      </MarkdownNavigationProvider>
    </div>
  );
}
