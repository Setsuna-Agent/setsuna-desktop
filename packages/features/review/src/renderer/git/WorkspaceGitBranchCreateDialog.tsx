import { Button, Dialog, TextField, ToastNotice } from '@setsuna-desktop/renderer-ui';
import { useId } from 'react';
import type { ReviewTranslate } from '../messages.js';

export function WorkspaceGitBranchCreateDialog({
  branchDraft,
  busy,
  error,
  onBranchDraftChange,
  onClose,
  onCreate,
  t,
}: {
  branchDraft: string;
  busy: boolean;
  error: string | null;
  onBranchDraftChange: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
  t: ReviewTranslate;
}) {
  const formId = useId();
  const canSubmit = Boolean(branchDraft.trim()) && !busy;

  return (
    <Dialog
      title={t('feature.review.git.createAndCheckout')}
      width={400}
      dismissible={!busy}
      onClose={onClose}
      footer={(
        <>
          <Button disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canSubmit} loading={busy}>
            {t('feature.review.git.createBranch')}
          </Button>
        </>
      )}
    >
      <form id={formId} onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onCreate();
      }}>
        <label className="sd-form-field">
          <span className="sd-form-label">{t('feature.review.git.branchName')}</span>
          <TextField
            autoFocus
            required
            autoComplete="off"
            spellCheck={false}
            value={branchDraft}
            disabled={busy}
            onChange={(event) => onBranchDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
            }}
          />
        </label>
      </form>
      {error ? <ToastNotice message={error} /> : null}
    </Dialog>
  );
}
