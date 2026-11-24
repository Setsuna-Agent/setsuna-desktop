import { Fragment, useMemo, useState } from 'react';
import { Button, Disclosure, SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { auditDesignBoard } from './design-board-audit.js';
import type { DesignReportView } from './design-layout-report.js';

type AuditIssues = ReturnType<typeof auditDesignBoard>['issues'];

function AuditIssueList({ issues, onLocate, translate: t }: {
  issues: AuditIssues; onLocate(id: string): void; translate: RendererTranslate;
}) {
  const [limit, setLimit] = useState(64);
  return <>
    {issues.slice(0, limit).map((issue) => <button type="button" key={issue.id + ':' + issue.kind + (issue.clipperId ?? '')}
      className="design-board-audit__issue" onClick={() => onLocate(issue.id)}>
      {issue.kind !== 'unverifiedContrast' && <span>{t(`feature.design.audit.${issue.kind}`)}{'ratio' in issue && 'minimum' in issue ? ' · ' + issue.ratio + ' / ' + issue.minimum : ''}
        {issue.affectedCount !== undefined && issue.affectedCount > 1 && ' · ' + t('feature.design.audit.affected', { count: issue.affectedCount })}</span>}
      <small>{issue.path.join(' › ')}</small>
    </button>)}
    {limit < issues.length && <Button onClick={() => setLimit((current) => current + 64)}>{t('feature.design.audit.more')}</Button>}
  </>;
}

export default function DesignBoardAudit({ projected, scene, revision, start, onLocate, translate: t }: DesignReportView & {
  revision: string; start?: string; onLocate(id: string): void; translate: RendererTranslate;
}) {
  const [chosen, setChosen] = useState(start);
  const board = chosen && projected.rootIds.includes(chosen) ? chosen : undefined;
  const boards = projected.rootIds.filter((id) => projected.nodes[id].kind === 'frame');
  const { issues, contrastReviews } = useMemo(() => {
    const report = auditDesignBoard({ projected, scene }, board ? [board] : projected.rootIds, revision);
    return {
      issues: report.issues.filter((issue) => issue.kind !== 'unverifiedContrast'),
      contrastReviews: report.issues.filter((issue) => issue.kind === 'unverifiedContrast'),
    };
  }, [projected, scene, board, revision]);
  return <div className="design-board-audit">
    <SelectField aria-label={t('feature.design.artboard')} value={board ?? ''} onValueChange={setChosen}>
      <option value="">{t('feature.design.audit.all')}</option>
      {boards.map((id) => <option key={id} value={id}>{projected.nodes[id].name || id}</option>)}
    </SelectField>
    <Fragment key={board ?? ''}>
      {!issues.length && !contrastReviews.length && <p>{t('feature.design.audit.clear')}</p>}
      <AuditIssueList issues={issues} onLocate={onLocate} translate={t} />
      {contrastReviews.length > 0 && <Disclosure title={t('feature.design.audit.unverifiedContrast')}>
        <AuditIssueList issues={contrastReviews} onLocate={onLocate} translate={t} />
      </Disclosure>}
    </Fragment>
  </div>;
}
