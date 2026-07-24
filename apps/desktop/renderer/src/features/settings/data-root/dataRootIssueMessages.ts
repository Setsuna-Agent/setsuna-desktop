import type {
  DesktopDataMigrationIssue,
  DesktopDataMigrationIssueCode,
} from '@setsuna-desktop/contracts';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../../shared/i18n/messages.js';

type IssueMessageKeys = {
  title: MessageKey;
  description: MessageKey;
};

const issueMessageKeys = {
  active_turns: {
    title: 'dataRoot.issue.active_turns.title',
    description: 'dataRoot.issue.active_turns.description',
  },
  existing_setsuna_data: {
    title: 'dataRoot.issue.existing_setsuna_data.title',
    description: 'dataRoot.issue.existing_setsuna_data.description',
  },
  insufficient_space: {
    title: 'dataRoot.issue.insufficient_space.title',
    description: 'dataRoot.issue.insufficient_space.description',
  },
  invalid_source: {
    title: 'dataRoot.issue.invalid_source.title',
    description: 'dataRoot.issue.invalid_source.description',
  },
  invalid_target: {
    title: 'dataRoot.issue.invalid_target.title',
    description: 'dataRoot.issue.invalid_target.description',
  },
  network_or_cloud_location: {
    title: 'dataRoot.issue.network_or_cloud_location.title',
    description: 'dataRoot.issue.network_or_cloud_location.description',
  },
  same_directory: {
    title: 'dataRoot.issue.same_directory.title',
    description: 'dataRoot.issue.same_directory.description',
  },
  source_target_nested: {
    title: 'dataRoot.issue.source_target_nested.title',
    description: 'dataRoot.issue.source_target_nested.description',
  },
  symlink_not_supported: {
    title: 'dataRoot.issue.symlink_not_supported.title',
    description: 'dataRoot.issue.symlink_not_supported.description',
  },
  target_unavailable: {
    title: 'dataRoot.issue.target_unavailable.title',
    description: 'dataRoot.issue.target_unavailable.description',
  },
  target_not_empty: {
    title: 'dataRoot.issue.target_not_empty.title',
    description: 'dataRoot.issue.target_not_empty.description',
  },
  unsupported_file: {
    title: 'dataRoot.issue.unsupported_file.title',
    description: 'dataRoot.issue.unsupported_file.description',
  },
} as const satisfies Record<DesktopDataMigrationIssueCode, IssueMessageKeys>;

const targetSymlinkMessageKeys = {
  title: 'dataRoot.issue.target_symlink.title',
  description: 'dataRoot.issue.target_symlink.description',
} as const satisfies IssueMessageKeys;

export type DataRootIssuePresentation = {
  title: string;
  description: string;
  path?: string;
};

export function presentDataRootIssue(
  issue: DesktopDataMigrationIssue,
  t: Translate,
  context: { targetRoot: string },
): DataRootIssuePresentation {
  const keys = issue.code === 'symlink_not_supported' && issue.path === context.targetRoot
    ? targetSymlinkMessageKeys
    : (issueMessageKeys as Partial<Record<string, IssueMessageKeys>>)[issue.code];
  if (!keys) {
    return {
      title: t('dataRoot.issue.unknown.title'),
      description: issue.message.trim() || t('dataRoot.issue.unknown.description'),
      ...(issue.path?.trim() ? { path: issue.path.trim() } : {}),
    };
  }
  return {
    title: t(keys.title),
    description: t(keys.description),
    ...(issue.path?.trim() ? { path: issue.path.trim() } : {}),
  };
}
