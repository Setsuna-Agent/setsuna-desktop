import type { MenuProps } from 'antd';
import { Check, ChevronDown, Ellipsis, Settings } from 'lucide-react';
import { useState } from 'react';
import type { DesktopGitRef } from '../../contracts/index.js';
import { useWorkspaceGitCommitDialog } from '../git/WorkspaceGitCommitDialog.js';
import { useReviewRendererHost } from '../host.js';
import { GitSettingsDialog } from '../git/GitSettingsDialog.js';

export function GitChangesMenu({ refs, selectedRef, currentBranch, filterVisible, busy, onSelectRef, onSelectHead, onToggleFilter }: {
  refs: DesktopGitRef[];
  selectedRef: string;
  currentBranch: string | null;
  filterVisible: boolean;
  busy: boolean;
  onSelectRef: (ref: DesktopGitRef) => void;
  onSelectHead: () => void;
  onToggleFilter: () => void;
}) {
  const { translate: t, ui: { ContextMenu } } = useReviewRendererHost();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const commitItems = useGitCommitMenuItems();
  const { composer, canOpenCommitDialog, openCommitDialog } = useWorkspaceGitCommitDialog();
  const items: MenuProps['items'] = [
    { key: 'filter', label: t('feature.review.history.filterFiles'), extra: filterVisible ? <Check size={13} /> : null, onClick: onToggleFilter },
    { type: 'divider' },
    { key: 'commit', label: t('feature.review.git.commit'), children: commitItems },
    {
      key: 'branches', label: t('feature.review.history.browse'), children: [
        { key: 'head', label: t('feature.review.history.current', { branch: currentBranch ?? 'HEAD' }), onClick: onSelectHead },
        ...(['local', 'remote', 'tag'] as const).map((kind) => ({
          key: kind,
          label: t(kind === 'local' ? 'feature.review.history.local' : kind === 'remote' ? 'feature.review.history.remote' : 'feature.review.history.tags'),
          disabled: !refs.some((ref) => ref.kind === kind),
          children: refs.filter((ref) => ref.kind === kind).map((ref) => ({ key: ref.name, label: ref.label, onClick: () => onSelectRef(ref) })),
        })),
      ],
    },
    { type: 'divider' },
    { key: 'pull', label: t('feature.review.git.pull'), disabled: !canOpenCommitDialog || composer?.busy, onClick: () => composer?.pull() },
    { key: 'pull-rebase', label: t('feature.review.git.pullRebase'), disabled: !canOpenCommitDialog || composer?.busy, onClick: () => composer?.pull({ rebase: true }) },
    { key: 'push', label: t('feature.review.git.push'), disabled: !canOpenCommitDialog || composer?.busy, onClick: composer?.push },
    { key: 'commit-options', label: t('feature.review.git.commitOrPush') + '…', disabled: !canOpenCommitDialog || composer?.busy, onClick: openCommitDialog },
    { type: 'divider' },
    { key: 'git-settings', icon: <Settings size={14} />, label: t('feature.review.git.settings'), onClick: () => setSettingsOpen(true) },
  ];
  return (
    <>
      <ContextMenu disabled={busy} trigger={['click']} placement="bottomRight" menu={{ items, selectedKeys: [selectedRef || 'head'] }}>
        <button disabled={busy} className="app-shell-icon-control git-changes-nav__more sd-icon-button sd-icon-button--ghost" type="button" aria-haspopup="menu" aria-label={t('feature.review.history.moreActions')} title={t('feature.review.history.moreActions')}>
          <Ellipsis size={16} />
        </button>
      </ContextMenu>
      {settingsOpen ? <GitSettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
    </>
  );
}

export function GitCommitActionMenu({ disabled = false }: { disabled?: boolean }) {
  const { translate: t, ui: { ContextMenu } } = useReviewRendererHost();
  const items = useGitCommitMenuItems();
  return (
    <ContextMenu disabled={disabled} trigger={['click']} placement="bottomRight" menu={{ items }}>
      <button disabled={disabled} className="git-changes-composer__commit-menu" type="button" aria-haspopup="menu" aria-label={t('feature.review.history.commitOptions')} title={t('feature.review.history.commitOptions')}>
        <ChevronDown size={13} />
      </button>
    </ContextMenu>
  );
}

function useGitCommitMenuItems(): MenuProps['items'] {
  const { translate: t } = useReviewRendererHost();
  const { composer } = useWorkspaceGitCommitDialog();
  const canCommit = Boolean(composer?.available && !composer.busy && composer.message.trim());
  return [
    { key: 'commit-only', label: t('feature.review.git.commit'), disabled: !canCommit, onClick: composer?.commit },
    { key: 'commit-amend', label: t('feature.review.git.commitAmend'), disabled: !composer?.canAmend || composer.busy, onClick: composer?.amend },
    { type: 'divider' },
    { key: 'commit-push', label: t('feature.review.git.commitAndPush'), disabled: !canCommit, onClick: composer?.commitAndPush },
    { key: 'commit-sync', label: t('feature.review.git.commitAndSync'), disabled: !canCommit, onClick: composer?.commitAndSync },
  ];
}
