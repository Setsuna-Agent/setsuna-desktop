import { Check, X } from 'lucide-react';
import { useReviewRendererHost } from '../host.js';
import { ReviewIconButton } from '../primitives.js';
import { useWorkspaceGitCommitDialog } from './WorkspaceGitCommitDialog.js';

export function GitCommitMessageEditor() {
  const { platform, translate: t, ui: { CommitMessageInput } } = useReviewRendererHost();
  const { messageEditor } = useWorkspaceGitCommitDialog();
  if (!messageEditor) return null;
  return (
    <section className="git-commit-message-editor" aria-label="COMMIT_EDITMSG">
      <header className="git-commit-message-editor__toolbar sd-panel-toolbar">
        <span className="git-commit-message-editor__title sd-panel-toolbar__surface">COMMIT_EDITMSG</span>
        <div className="sd-panel-toolbar__surface sd-panel-toolbar__actions">
          <ReviewIconButton className="app-shell-icon-control" label={t('feature.review.git.saveCommitMessage')} title={t('feature.review.git.saveCommitMessage') + (platform === 'darwin' ? ' (⌘S)' : ' (Ctrl+S)')} disabled={!messageEditor.canSave} onClick={messageEditor.save}><Check size={15} /></ReviewIconButton>
          <ReviewIconButton className="app-shell-icon-control" label={t('common.cancel')} onClick={messageEditor.cancel}><X size={15} /></ReviewIconButton>
        </div>
      </header>
      <CommitMessageInput
        content={messageEditor.message}
        onChange={messageEditor.setMessage}
        onSave={() => { if (messageEditor.canSave) messageEditor.save(); }}
      />
    </section>
  );
}
