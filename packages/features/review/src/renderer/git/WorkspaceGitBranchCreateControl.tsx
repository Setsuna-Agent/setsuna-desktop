import { TextField, Button } from '@setsuna-desktop/renderer-ui';

import { Check, Loader2, Plus } from 'lucide-react';
import type { FormEvent } from 'react';
import type { ReviewTranslate } from '../messages.js';

export function WorkspaceGitBranchCreateControl({
  branchDraft,
  busy,
  compact = false,
  creatingBranch,
  submitting,
  onBranchDraftChange,
  onCancelCreate,
  onCreate,
  onCreateStart,
  t,
}: {
  branchDraft: string;
  busy: boolean;
  compact?: boolean;
  creatingBranch: boolean;
  submitting: boolean;
  onBranchDraftChange: (value: string) => void;
  onCancelCreate: () => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onCreateStart: () => void;
  t: ReviewTranslate;
}) {
  if (!creatingBranch) {
    return (
      <Button variant="ghost"
        type="button"
        className="sd-picker__item"
        disabled={busy}
        onClick={onCreateStart}
      >
        <Plus size={14} />
        <span>{t(compact ? 'feature.review.git.newBranch' : 'feature.review.git.createAndCheckout')}</span>
      </Button>
    );
  }
  return (
    <form
      className={`chat-git-branch-menu__create-form ${compact ? 'chat-git-branch-menu__create-form--compact' : ''}`}
      onSubmit={onCreate}
    >
      <TextField
        autoFocus
        value={branchDraft}
        placeholder={t('feature.review.git.branchNamePlaceholder')}
        disabled={busy}
        onChange={(event) => onBranchDraftChange(event.currentTarget.value)}
      />
      <Button variant="ghost"
        type="submit"
        disabled={busy}
        aria-label={t('feature.review.git.createBranch')}
      >
        {submitting
          ? <Loader2 className="chat-git-loading-icon" size={13} />
          : compact ? t('feature.review.git.create') : <Check size={13} />}
      </Button>
      <Button variant="ghost" type="button" disabled={busy} onClick={onCancelCreate}>
        {t('common.cancel')}
      </Button>
    </form>
  );
}
