import { useMemo, useState } from 'react';
import { Button, SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { auditDesignBoard } from './design-board-audit.js';
import type { DesignReportView } from './design-layout-report.js';

export default function DesignBoardAudit({ projected, scene, revision, start, onLocate, translate: t }: DesignReportView & {
  revision: string; start?: string; onLocate(id: string): void; translate: RendererTranslate;
}) {
  const [chosen, setChosen] = useState(start);
  const [limit, setLimit] = useState(64);
  const board = chosen && projected.rootIds.includes(chosen) ? chosen : undefined;
  const boards = projected.rootIds.filter((id) => projected.nodes[id].kind === 'frame');
  const report = useMemo(() => auditDesignBoard({ projected, scene }, board ? [board] : projected.rootIds, revision), [projected, scene, board, revision]);
  return <div className="design-tool-popover__content design-board-audit">
    <SelectField aria-label={t('feature.design.artboard')} value={board ?? ''} onValueChange={(id) => { setChosen(id); setLimit(64); }}>
      <option value="">{t('feature.design.audit.all')}</option>
      {boards.map((id) => <option key={id} value={id}>{projected.nodes[id].name || id}</option>)}
    </SelectField>
    {!report.issueCount && <p>{t('feature.design.audit.clear')}</p>}
    {report.issues.slice(0, limit).map((issue) => <button type="button" key={issue.id + ':' + issue.kind + (issue.clipperId ?? '')}
      className="design-board-audit__issue" onClick={() => onLocate(issue.id)}>
      <span>{t(`feature.design.audit.${issue.kind}`)}{'ratio' in issue && 'minimum' in issue ? ' · ' + issue.ratio + ' / ' + issue.minimum : ''}
        {issue.affectedCount !== undefined && issue.affectedCount > 1 && ' · ' + t('feature.design.audit.affected', { count: issue.affectedCount })}</span>
      <small>{issue.path.join(' › ')}</small>
    </button>)}
    {limit < report.issueCount && <Button onClick={() => setLimit(limit + 64)}>{t('feature.design.audit.more')}</Button>}
  </div>;
}
