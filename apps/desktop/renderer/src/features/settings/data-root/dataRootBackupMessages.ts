import type { Translate } from '../../../shared/i18n/I18nProvider.js';

export function retainedBackupErrorMessage(
  code: string | undefined,
  t: Translate,
): string {
  switch (code) {
    case 'backup_unavailable':
    case 'backup_inspection_failed':
      return t('dataRoot.backup.error.unavailable');
    case 'backup_changed':
      return t('dataRoot.backup.error.changed');
    case 'backup_cleanup_unsafe_path':
      return t('dataRoot.backup.error.unsafePath');
    case 'backup_cleanup_conflict':
      return t('dataRoot.backup.error.conflict');
    case 'backup_not_found':
      return t('dataRoot.backup.error.notFound');
    case 'backup_cleanup_busy':
      return t('dataRoot.backup.error.busy');
    default:
      return t('dataRoot.backup.error.generic');
  }
}
