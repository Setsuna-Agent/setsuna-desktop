import { ConfirmDialog } from '@setsuna-desktop/renderer-ui';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { useThreadWorkspaceRecovery } from './hooks/useThreadWorkspaceRecovery.js';

export function MissingWorktreeDialog({ project, onClose, ...recoveryOptions }: Parameters<typeof useThreadWorkspaceRecovery>[0] & {
  project?: WorkspaceProject;
  onClose(): void;
}) {
  const { t } = useI18n();
  const { pending, failed, recover } = useThreadWorkspaceRecovery(recoveryOptions);
  const canSwitch = Boolean(project?.path);
  return <ConfirmDialog
    open
    title={t('workspace.worktree.missing')}
    description={canSwitch
      ? t('workspace.worktree.switchDescription', { project: project!.name })
      : t('workspace.worktree.projectUnavailable')}
    confirmLabel={canSwitch ? t('workspace.worktree.switchToProject') : t('common.close')}
    cancelLabel={t('workspace.worktree.keepConversation')}
    acknowledgement={!canSwitch}
    pending={pending}
    error={failed ? t('workspace.worktree.switchFailed') : null}
    onConfirm={() => { if (canSwitch) void recover(); else onClose(); }}
    onClose={onClose}
  />;
}
