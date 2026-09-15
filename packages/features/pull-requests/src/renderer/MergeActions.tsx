import { Button, Dialog, Dropdown, SelectField } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, GitMerge } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MergeMethod, PullRequestAction, PullRequestDetail } from '../contracts/index.js';
import { isAccountChangedError, type PullRequestsClient } from './client.js';
import { errorText, usePrText, usePullRequestsHost } from './context.js';
import { mergeCondition } from './status.js';

export function MergeActions({ client, detail, account, onUpdated }: { client: PullRequestsClient; detail: PullRequestDetail; account: string; onUpdated(): void }) {
  const t = usePrText();
  const { notifyError } = usePullRequestsHost();
  const [confirmation, setConfirmation] = useState<{ action: PullRequestAction['action']; detail: PullRequestDetail; account: string } | null>(null);
  const action = confirmation?.action;
  const reviewed = confirmation?.detail ?? detail;
  const openAction = (action: PullRequestAction['action']) => { setError(''); setConfirmation({ action, detail, account }); };
  const [method, setMethod] = useState<MergeMethod>(detail.allowedMethods.includes('SQUASH') ? 'SQUASH' : detail.allowedMethods[0] ?? 'MERGE');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const closed = detail.state !== 'OPEN';
  const canAct = !closed && !detail.draft && detail.canMerge && !detail.queueState;
  // GitHub validates queue eligibility against the latest base; BEHIND is allowed.
  const canEnqueue = canAct && detail.queueRequired;
  const canMerge = canAct && !detail.queueRequired
    && detail.mergeable === 'MERGEABLE' && ['CLEAN', 'UNSTABLE', 'HAS_HOOKS'].includes(detail.mergeState);
  const selectedMethod = reviewed.allowedMethods.includes(method) ? method : reviewed.allowedMethods[0] ?? 'MERGE';
  const label = action === 'enable-auto-merge' ? t('enableAutoMerge') : action === 'disable-auto-merge' ? t('disableAutoMerge') : action === 'enqueue' ? t('enqueue') : t('merge');
  const submit = async () => {
    if (!confirmation || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      await client.act({ repository: reviewed.repository, number: reviewed.number, expectedAccount: confirmation.account, headSha: reviewed.headSha, baseBranch: reviewed.baseBranch, method: selectedMethod, action: confirmation.action });
      setConfirmation(null);
    } catch (cause) {
      if (isAccountChangedError(cause)) { setConfirmation(null); notifyError(t('accountChanged')); }
      else setError(errorText(cause));
    }
    finally { submitting.current = false; setPending(false); onUpdated(); }
  };
  return <>
    <Dropdown menu={{ items: [
      { key: 'merge', label: detail.queueRequired ? t('enqueue') : t('merge'), disabled: detail.queueRequired ? !canEnqueue : !canMerge, onClick: () => openAction(detail.queueRequired ? 'enqueue' : 'merge') },
      { key: 'auto', label: detail.autoMerge ? t('disableAutoMerge') : t('enableAutoMerge'), disabled: closed || (detail.autoMerge ? !detail.canDisableAutoMerge : !detail.canEnableAutoMerge), onClick: () => openAction(detail.autoMerge ? 'disable-auto-merge' : 'enable-auto-merge') },
    ] }}><Button size="small" icon={<GitMerge size={14} />} disabled={pending || closed}>{t('merge')}<ChevronDown size={13} /></Button></Dropdown>
    {action ? <Dialog title={label} onClose={() => setConfirmation(null)} dismissible={!pending} width={520} footer={<><Button disabled={pending} onClick={() => setConfirmation(null)}>{t('cancel')}</Button><Button variant="primary" loading={pending} onClick={() => void submit()}>{label}</Button></>}>
      <div className="pr-merge-confirm">
        <strong>{reviewed.repository} #{reviewed.number}</strong><p>{reviewed.title}</p>
        <code>{reviewed.headBranch} → {reviewed.baseBranch}</code><small>{reviewed.headSha.slice(0, 12)}</small>
        {action !== 'disable-auto-merge' && action !== 'enqueue' ? <SelectField aria-label={t('mergeMethod')} value={selectedMethod} onValueChange={(value) => setMethod(value as MergeMethod)}>{reviewed.allowedMethods.map((value) => <option key={value} value={value}>{value === 'SQUASH' ? 'Squash and merge' : value === 'REBASE' ? 'Rebase and merge' : 'Create a merge commit'}</option>)}</SelectField> : null}
        <p className="pr-muted">{action === 'enable-auto-merge' ? t('autoMergeDescription') : mergeCondition(detail, t).label}</p>
        {error ? <p className="sd-control-error" role="alert">{error}</p> : null}
      </div>
    </Dialog> : null}
  </>;
}
