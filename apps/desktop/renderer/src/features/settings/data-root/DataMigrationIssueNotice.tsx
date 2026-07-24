import type { DesktopDataMigrationIssue } from '@setsuna-desktop/contracts';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { presentDataRootIssue } from './dataRootIssueMessages.js';

type DataMigrationIssueNoticeProps = {
  issue: DesktopDataMigrationIssue;
  severity: 'blocker' | 'warning';
  targetRoot: string;
};

export function DataMigrationIssueNotice({
  issue,
  severity,
  targetRoot,
}: DataMigrationIssueNoticeProps) {
  const { t } = useI18n();
  const presentation = presentDataRootIssue(issue, t, { targetRoot });
  const Icon = severity === 'blocker' ? CircleAlert : TriangleAlert;

  return (
    <div
      className={`data-root-plan__issue is-${severity}`}
      role={severity === 'blocker' ? 'alert' : 'status'}
    >
      <Icon className="data-root-plan__issue-icon" aria-hidden="true" size={17} />
      <div className="data-root-plan__issue-content">
        <strong>{presentation.title}</strong>
        <p>{presentation.description}</p>
        {presentation.path ? (
          <div className="data-root-plan__issue-path">
            <span>{t('dataRoot.issue.path')}</span>
            <code title={presentation.path}>{presentation.path}</code>
          </div>
        ) : null}
      </div>
    </div>
  );
}
