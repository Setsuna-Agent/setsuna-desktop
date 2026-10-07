import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { AutomationActivityEntry } from './activity.js';
import { formatAutomationTime } from './format.js';
import { AutomationSidebarRow } from './AutomationSidebarRow.js';

type AutomationActivityProps = {
  entries: AutomationActivityEntry[];
  selectedRunId: string | null;
  translate: RendererTranslate;
  locale: string;
  onSelect(threadId: string, taskId: string, runId: string): Promise<void>;
};

export function AutomationActivity({ entries, selectedRunId, translate: t, locale, onSelect }: AutomationActivityProps) {
  return (
    <section className="automation-sidebar__activity">
      <h3>{t('feature.automation.activity')}</h3>
      <div className="automation-sidebar__runs">
        {entries.length ? entries.map(({ taskId, taskTitle, run }) => (
          <AutomationSidebarRow key={`${taskId}/${run.id}`} title={taskTitle} tooltip={run.error ?? taskTitle}
            active={selectedRunId === run.id}
            detail={`${formatAutomationTime(run.startedAt, locale)} · ${t(`feature.automation.run.${run.status}`)}`}
            onClick={() => void onSelect(run.threadId, taskId, run.id)} />
        )) : <p className="automation-sidebar__empty">{t('feature.automation.emptyActivity')}</p>}
      </div>
    </section>
  );
}
