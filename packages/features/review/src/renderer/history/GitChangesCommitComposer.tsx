import { Button, ResizeHandle, TextArea } from '@setsuna-desktop/renderer-ui';

import { Check, Loader2, Sparkles } from 'lucide-react';
import { GitOperationError } from '../git/GitOperationError.js';
import { useWorkspaceGitCommitDialog } from '../git/WorkspaceGitCommitDialog.js';
import { useReviewRendererHost } from '../host.js';
import { ReviewActionTooltip } from '../primitives.js';
import { GitCommitActionMenu } from './GitChangesMenu.js';
import { useCommitMessageInputResize } from './useCommitMessageInputResize.js';

/** Both commit surfaces share the draft and in-flight action; the sidebar commits only the index. */
export function GitChangesCommitComposer({ blocked = false }: { blocked?: boolean }) {
  const { composer } = useWorkspaceGitCommitDialog();
  const { translate: t } = useReviewRendererHost();
  const { inputRef, height, resizeHandleProps } = useCommitMessageInputResize();
  const message = composer?.message ?? '';
  const busy = Boolean(composer?.busy || blocked);
  const canCommit = Boolean(composer?.available && !busy && message.trim());
  const target = t('feature.review.history.commitTarget', { branch: composer?.currentBranch ?? 'HEAD' });

  return (
    <form className="git-changes-composer" aria-label={target} onSubmit={(event) => {
      event.preventDefault();
      if (canCommit) composer?.commit();
    }}>
      <div className="git-changes-composer__input">
        <TextArea
          ref={inputRef}
          autoSize={height === null ? { minRows: 1, maxRows: 3 } : false}
          style={height === null ? undefined : { height }}
          rows={1}
          wrap="soft"
          aria-label={t('feature.review.history.messageLabel')}
          placeholder={t('feature.review.history.messagePlaceholder', {
            branch: composer?.currentBranch ?? 'HEAD',
          })}
          value={message}
          disabled={!composer || busy}
          onChange={(event) => composer?.setMessage(event.currentTarget.value)}
        />
        <ReviewActionTooltip
          className="git-changes-composer__generate-tooltip"
          title={t(composer?.generating ? 'feature.review.git.generatingMessage' : 'feature.review.history.generateMessage')}
        >
          <Button variant="ghost"
            className="git-changes-composer__generate"
            type="button"
            aria-label={t('feature.review.history.generateMessage')}
            aria-busy={composer?.generating || undefined}
            disabled={!composer?.available || busy}
            onClick={composer?.generateMessage}
          >
            {composer?.generating ? <Loader2 size={14} className="chat-git-loading-icon" /> : <Sparkles size={14} />}
          </Button>
        </ReviewActionTooltip>
        <ResizeHandle
          {...resizeHandleProps}
          className="git-changes-composer__resize"
          aria-orientation="horizontal"
          aria-label={t('feature.review.history.resizeMessage')}
          title={t('feature.review.history.resizeMessageHint')}
        />
      </div>
      <div className="git-changes-composer__submit">
        <Button variant="primary" size="small" className="git-changes-nav__commit" type="submit"
          disabled={!canCommit} loading={composer?.committing} icon={<Check size={14} />} title={target}>
          {t(composer?.committing ? 'feature.review.git.committing' : 'feature.review.git.commit')}
        </Button>
        <GitCommitActionMenu disabled={busy} />
      </div>
      {composer?.error ? <GitOperationError message={composer.error} onDismiss={composer.dismissError} /> : null}
    </form>
  );
}
