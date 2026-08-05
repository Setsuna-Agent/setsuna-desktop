import { Check, Loader2, Plus } from 'lucide-react';
import type { FormEvent } from 'react';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';

export function WorkspaceGitBranchCreateControl({
  branchDraft,
  busy,
  compact = false,
  creatingBranch,
  disabledReason,
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
  disabledReason?: string | null;
  submitting: boolean;
  onBranchDraftChange: (value: string) => void;
  onCancelCreate: () => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onCreateStart: () => void;
  t: Translate;
}) {
  const createDisabled = busy || Boolean(disabledReason);
  if (!creatingBranch) {
    return (
      <button
        type="button"
        className={`chat-git-branch-menu__create ${disabledReason ? 'has-detail' : ''}`}
        disabled={createDisabled}
        title={disabledReason ?? undefined}
        onClick={onCreateStart}
      >
        <Plus size={14} />
        <span className="chat-git-branch-menu__create-body">
          <span>{t(compact ? 'conversation.git.newBranch' : 'conversation.git.createAndCheckout')}</span>
          {disabledReason ? <small>{disabledReason}</small> : null}
        </span>
      </button>
    );
  }
  return (
    <form
      className={`chat-git-branch-menu__create-form ${compact ? 'chat-git-branch-menu__create-form--compact' : ''}`}
      onSubmit={onCreate}
    >
      <input
        autoFocus
        value={branchDraft}
        placeholder={t('conversation.git.branchNamePlaceholder')}
        disabled={createDisabled}
        onChange={(event) => onBranchDraftChange(event.currentTarget.value)}
      />
      <button
        type="submit"
        disabled={createDisabled}
        aria-label={t('conversation.git.createBranch')}
        title={disabledReason ?? undefined}
      >
        {submitting
          ? <Loader2 className="chat-git-loading-icon" size={13} />
          : compact ? t('conversation.git.create') : <Check size={13} />}
      </button>
      <button type="button" disabled={busy} onClick={onCancelCreate}>
        {t('common.cancel')}
      </button>
    </form>
  );
}
