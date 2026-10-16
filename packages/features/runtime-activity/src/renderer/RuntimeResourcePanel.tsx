import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import type { RuntimeActivityDesktopBridge, RuntimeActivityRendererService } from '../contracts/index.js';
import { resourceProcessName } from './resource-model.js';
import { ResourceProcessTerminateButton } from './ResourceProcessTerminateButton.js';
import { useResourceSnapshot } from './use-resource-snapshot.js';
import './runtime-resources.css';

export function RuntimeResourcePanel({ desktopBridge, service, translate: t }: {
  desktopBridge: RuntimeActivityDesktopBridge | null;
  service: RuntimeActivityRendererService;
  translate: RendererTranslate;
}) {
  const { processes, error, loading, refresh } = useResourceSnapshot(desktopBridge, service);
  if (loading) return <div className="runtime-activity-empty" aria-busy="true"><LoaderCircle size={18} className="is-spinning" /></div>;
  return <div className="runtime-resources">
    {error ? <div className="runtime-resources__error" role="alert"><CircleAlert size={14} aria-hidden="true" />{t('feature.runtimeActivity.refreshFailed', { error })}</div> : null}
    <div className="runtime-resources__table" role="table" aria-label={t('feature.runtimeActivity.resources.title')}>
      <div className="runtime-resources__row runtime-resources__header" role="row">
        <span role="columnheader">{t('feature.runtimeActivity.resources.process')}</span>
        <span role="columnheader">{t('feature.runtimeActivity.resources.type')}</span>
        <span role="columnheader">PID</span>
        <span role="columnheader" title={t('feature.runtimeActivity.resources.cpuTooltip')}>CPU</span>
        <span role="columnheader" title={t('feature.runtimeActivity.resources.memoryTooltip')}>{t('feature.runtimeActivity.resources.memory')}</span>
        <span role="columnheader">{t('feature.runtimeActivity.column.action')}</span>
      </div>
      <div className="runtime-resources__body" role="rowgroup">
        {processes.map((item) => {
          const name = resourceProcessName(item, t);
          return <div className="runtime-resources__row" role="row" key={`${item.pid}:${item.startedAt}`}>
            <div className="runtime-resources__identity" role="cell" title={item.pages.length
              ? item.pages.map(page => [page.title, page.url].filter(Boolean).join('\n')).join('\n\n') || name : name}>
              {name}
            </div>
            <span role="cell" className="runtime-resources__type" title={item.type}>{item.type}</span>
            <span role="cell">{item.pid}</span>
            <span role="cell">{item.cpuPercent === null ? '—' : `${item.cpuPercent.toFixed(1)}%`}</span>
            <span role="cell">{(item.residentBytes / 1024 / 1024).toFixed(1)} MiB</span>
            <span role="cell" title={!item.canTerminate ? t('feature.runtimeActivity.resources.protected') : undefined}>
              <ResourceProcessTerminateButton process={item} desktopBridge={desktopBridge} onTerminated={refresh} translate={t} />
            </span>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
