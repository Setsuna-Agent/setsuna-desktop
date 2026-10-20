import { Button, Dialog, TextArea, TextField } from '@setsuna-desktop/renderer-ui';
import { GitCommitHorizontal } from 'lucide-react';
import { useId } from 'react';
import type { PullRequestMergeMessage } from '../../contracts/index.js';
import type { PullRequestsClient } from '../client.js';
import { usePrText } from '../context.js';
import { PullRequestBranches } from '../PullRequestMetaPanel.js';
import { useMergeCommitMessage, type MergeConfirmation } from './useMergeCommitMessage.js';

export function MergeConfirmationDialog({ client, confirmation, pending, error, onClose, onConfirm }: {
  client: PullRequestsClient;
  confirmation: MergeConfirmation;
  pending: boolean;
  error: string;
  onClose(): void;
  onConfirm(message: PullRequestMergeMessage | null): void;
}) {
  const t = usePrText();
  const formId = useId();
  const draft = useMergeCommitMessage(client, confirmation);
  const canSubmit = !pending && (!draft.editable || Boolean(draft.message?.title.trim()));
  const { action, detail, method } = confirmation;
  const label = action === 'merge' ? t(`mergeMethod.${method}`)
    : action === 'enqueue' ? t('enqueue')
    : action === 'enable-auto-merge' ? t('enableAutoMerge') : t('disableAutoMerge');
  return <Dialog title={label} className="pr-merge-dialog" width={draft.editable ? 560 : 460} onClose={onClose} dismissible={!pending}
    footer={<>
      <Button disabled={pending} onClick={onClose}>{t('cancel')}</Button>
      {draft.error ? <Button variant="primary" onClick={draft.retry}>{t('retry')}</Button>
        : <Button variant="primary" type="submit" form={formId} loading={pending || draft.loading} disabled={!canSubmit}>{label}</Button>}
    </>}>
    <form id={formId} className="pr-merge-confirm" onSubmit={(event) => {
      event.preventDefault();
      if (canSubmit) onConfirm(draft.editable ? draft.message : null);
    }}>
      <div className="pr-merge-confirm__request">
        <span className="pr-merge-confirm__reference">{detail.repository} <span>#{detail.number}</span></span>
        <strong className="pr-merge-confirm__title">{detail.title}</strong>
        <div className="pr-merge-confirm__revision">
          <PullRequestBranches detail={detail} />
          <code className="pr-merge-confirm__sha" title={detail.headSha}>
            <GitCommitHorizontal size={13} aria-hidden="true" />{detail.headSha.slice(0, 12)}
          </code>
        </div>
      </div>
      {draft.editable ? <>
        <label className="pr-merge-confirm__field">
          <span>{t('commitTitle')}</span>
          <TextField value={draft.message?.title ?? ''} required maxLength={100_000} disabled={pending || !draft.message}
            onChange={(event) => {
              const title = event.currentTarget.value;
              draft.setMessage((current) => current ? { ...current, title } : current);
            }} />
        </label>
        <label className="pr-merge-confirm__field">
          <span>{t('commitBody')}</span>
          <TextArea value={draft.message?.body ?? ''} rows={6} maxLength={1_000_000} disabled={pending || !draft.message}
            onChange={(event) => {
              const body = event.currentTarget.value;
              draft.setMessage((current) => current ? { ...current, body } : current);
            }} />
        </label>
      </> : null}
      {action === 'enable-auto-merge' ? <div className="pr-merge-confirm__automatic">
        <span>{t(`mergeMethod.${method}`)}</span>
        <p>{t('autoMergeDescription')}</p>
      </div> : null}
      {error || draft.error ? <p className="sd-control-error" role="alert">{error || draft.error}</p> : null}
    </form>
  </Dialog>;
}
