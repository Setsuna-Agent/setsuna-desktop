import { Button, Dialog } from '@setsuna-desktop/renderer-ui';
import { GitCommitHorizontal } from 'lucide-react';
import type { MergeMethod, PullRequestAction, PullRequestDetail } from '../../contracts/index.js';
import { usePrText } from '../context.js';
import { PullRequestBranches } from '../PullRequestMetaPanel.js';

/** The confirmation owns the revision, identity and method the user reviewed. */
export type MergeConfirmation = {
  action: PullRequestAction['action'];
  detail: PullRequestDetail;
  account: string;
  method: MergeMethod;
};

export function MergeConfirmationDialog({ confirmation, pending, error, onClose, onConfirm }: {
  confirmation: MergeConfirmation;
  pending: boolean;
  error: string;
  onClose(): void;
  onConfirm(): void;
}) {
  const t = usePrText();
  const { action, detail, method } = confirmation;
  const label = action === 'merge' ? t(`mergeMethod.${method}`)
    : action === 'enqueue' ? t('enqueue')
    : action === 'enable-auto-merge' ? t('enableAutoMerge') : t('disableAutoMerge');
  return <Dialog title={label} className="pr-merge-dialog" width={460} onClose={onClose} dismissible={!pending}
    footer={<>
      <Button disabled={pending} onClick={onClose}>{t('cancel')}</Button>
      <Button variant="primary" loading={pending} onClick={onConfirm}>{label}</Button>
    </>}>
    <div className="pr-merge-confirm">
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
      {action === 'enable-auto-merge' ? <div className="pr-merge-confirm__automatic">
        <span>{t(`mergeMethod.${method}`)}</span>
        <p>{t('autoMergeDescription')}</p>
      </div> : null}
      {error ? <p className="sd-control-error" role="alert">{error}</p> : null}
    </div>
  </Dialog>;
}
