import { Input } from 'antd';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { GitOperationError } from '../git/GitOperationError.js';
import { useWorkspaceGitCommitDialog } from '../git/WorkspaceGitCommitDialog.js';
import { useReviewRendererHost } from '../host.js';
import { GitCommitActionMenu } from './GitChangesMenu.js';
import { useCommitMessageInputResize } from './useCommitMessageInputResize.js';

/** Both commit surfaces share the draft and in-flight action; the sidebar commits only the index. */
export function GitChangesCommitComposer({ blocked = false }: { blocked?: boolean }) {
  const { composer } = useWorkspaceGitCommitDialog();
  const { platform, translate: t } = useReviewRendererHost();
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
        <Input.TextArea
          ref={inputRef}
          variant="borderless"
          autoSize={height === null ? { minRows: 1, maxRows: 3 } : false}
          style={height === null ? undefined : { height }}
          rows={1}
          wrap="soft"
          aria-label={t('feature.review.history.messageLabel')}
          placeholder={t('feature.review.history.messagePlaceholder', {
            shortcut: platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter',
            branch: composer?.currentBranch ?? 'HEAD',
          })}
          value={message}
          disabled={!composer || busy}
          onChange={(event) => composer?.setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (canCommit) composer?.commit();
          }}
        />
        <button
          className="git-changes-composer__generate"
          type="button"
          title={t(composer?.generating ? 'feature.review.git.generatingMessage' : 'feature.review.history.generateMessage')}
          aria-label={t('feature.review.history.generateMessage')}
          aria-busy={composer?.generating || undefined}
          disabled={!composer?.available || busy}
          onClick={composer?.generateMessage}
        >
          {composer?.generating ? <Loader2 size={14} className="chat-git-loading-icon" /> : <Sparkles size={14} />}
        </button>
        <button
          {...resizeHandleProps}
          className="git-changes-composer__resize"
          type="button"
          aria-label={t('feature.review.history.resizeMessage')}
          title={t('feature.review.history.resizeMessageHint')}
        />
      </div>
      <div className={'git-changes-composer__submit' + (canCommit ? ' is-ready' : '')}>
        <button className="git-changes-nav__commit" type="submit" disabled={!canCommit} title={target}>
          {composer?.committing ? <Loader2 size={14} className="chat-git-loading-icon" /> : <Check size={14} />}
          <span>{t(composer?.committing ? 'feature.review.git.committing' : 'feature.review.git.commit')} <kbd>{platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter'}</kbd></span>
        </button>
        <GitCommitActionMenu disabled={busy} />
      </div>
      {composer?.error ? <GitOperationError message={composer.error} onDismiss={composer.dismissError} /> : null}
    </form>
  );
}
