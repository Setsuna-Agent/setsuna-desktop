import { Button, Dropdown } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, GitMerge } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MergeMethod, PullRequestAction, PullRequestDetail } from '../contracts/index.js';
import { isAccountChangedError, type PullRequestsClient } from './client.js';
import { errorText, usePrText, usePullRequestsHost } from './context.js';
import { MergeConfirmationDialog, type MergeConfirmation } from './merge/MergeConfirmationDialog.js';
import './merge/merge-actions.css';

export function MergeActions({ client, detail, account, onUpdated }: { client: PullRequestsClient; detail: PullRequestDetail; account: string; onUpdated(): void }) {
  const t = usePrText();
  const { notifyError } = usePullRequestsHost();
  const [confirmation, setConfirmation] = useState<MergeConfirmation | null>(null);
  const [method, setMethod] = useState<MergeMethod>(detail.allowedMethods.includes('SQUASH') ? 'SQUASH' : detail.allowedMethods[0] ?? 'MERGE');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuConfirmation = useRef<MergeConfirmation | null>(null);
  const closed = detail.state !== 'OPEN';
  const canAct = !closed && !detail.draft && detail.canMerge && !detail.queueState;
  // GitHub validates queue eligibility against the latest base; BEHIND is allowed.
  const canEnqueue = canAct && detail.queueRequired;
  const canMerge = canAct && !detail.queueRequired
    && detail.mergeable === 'MERGEABLE' && ['CLEAN', 'UNSTABLE', 'HAS_HOOKS'].includes(detail.mergeState);
  const selectedMethod = detail.allowedMethods.includes(method) ? method : detail.allowedMethods[0] ?? 'MERGE';
  const snapshot = (action: PullRequestAction['action']): MergeConfirmation => ({ action, detail, account, method: selectedMethod });
  const openConfirmation = (next: MergeConfirmation) => { setError(''); setConfirmation(next); };
  const submit = async () => {
    if (!confirmation || submitting.current) return;
    const reviewed = confirmation.detail;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      await client.act({ repository: reviewed.repository, number: reviewed.number, expectedAccount: confirmation.account, headSha: reviewed.headSha, baseBranch: reviewed.baseBranch, method: confirmation.method, action: confirmation.action });
      setConfirmation(null);
    } catch (cause) {
      if (isAccountChangedError(cause)) { setConfirmation(null); notifyError(t('accountChanged')); }
      else setError(errorText(cause));
    }
    finally { submitting.current = false; setPending(false); onUpdated(); }
  };
  return <>
    <div className="pr-merge-actions" role="group" aria-label={t('merge')}>
      <Button variant="primary" size="small" icon={<GitMerge size={14} aria-hidden="true" />}
        disabled={pending || (detail.queueRequired ? !canEnqueue : !canMerge)}
        onClick={() => openConfirmation(snapshot(detail.queueRequired ? 'enqueue' : 'merge'))}>
        {detail.queueRequired ? t('enqueue') : t(`mergeMethod.${selectedMethod}`)}
      </Button>
      <Dropdown placement="bottomRight" disabled={pending || closed}
        onCloseAutoFocus={(event) => {
          const next = menuConfirmation.current;
          menuConfirmation.current = null;
          if (!next) return;
          // Close the menu before the dialog captures its return-focus target.
          event.preventDefault();
          menuTrigger.current?.focus({ preventScroll: true });
          openConfirmation(next);
        }}
        menu={{ selectedKeys: detail.queueRequired ? [] : [selectedMethod], items: [
          ...(!detail.queueRequired ? detail.allowedMethods.map((value) => ({
            key: value, label: t(`mergeMethod.${value}`), onClick: () => setMethod(value),
          })) : []),
          !detail.queueRequired && detail.allowedMethods.length > 0 && { type: 'divider' },
          {
            key: 'auto', label: detail.autoMerge ? t('disableAutoMerge') : t('enableAutoMerge'),
            disabled: detail.autoMerge ? !detail.canDisableAutoMerge : !detail.canEnableAutoMerge,
            onClick: () => { menuConfirmation.current = snapshot(detail.autoMerge ? 'disable-auto-merge' : 'enable-auto-merge'); },
          },
        ] }}>
        <Button ref={menuTrigger} variant="primary" size="small" aria-label={t('mergeMethod')} title={t('mergeMethod')} disabled={pending || closed}>
          <ChevronDown size={13} aria-hidden="true" />
        </Button>
      </Dropdown>
    </div>
    {confirmation ? <MergeConfirmationDialog confirmation={confirmation} pending={pending} error={error}
      onClose={() => setConfirmation(null)} onConfirm={() => void submit()} /> : null}
  </>;
}
