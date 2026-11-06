import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown } from '@setsuna-desktop/renderer-ui';
import { Trash2 } from 'lucide-react';
import type { AutomationActivityEntry } from '../contracts/index.js';
import { formatAutomationTime } from './format.js';
import { AutomationSidebarRow } from './AutomationSidebarRow.js';

type AutomationActivityProps = {
  entries: AutomationActivityEntry[];
  selectedRunId: string | null;
  busy: boolean;
  translate: RendererTranslate;
  locale: string;
  onSelect(threadId: string, taskId: string, runId: string): Promise<void>;
  onDelete(entry: AutomationActivityEntry): Promise<void>;
};

export function AutomationActivity({ entries, selectedRunId, busy, translate: t, locale, onSelect, onDelete }: AutomationActivityProps) {
  if (!entries.length) return null;

  return (
    <section className="automation-sidebar__activity">
      <h3>{t('feature.automation.activity')}</h3>
      <div className="automation-sidebar__runs">
        {entries.map((entry) => (
          <Dropdown key={`${entry.taskId}/${entry.run.id}`} trigger={['contextMenu']} disabled={busy} menu={{ items: [{
            key: 'delete', label: t('feature.automation.deleteRun'), icon: <Trash2 size={15} />, danger: true,
            disabled: entry.run.status === 'running',
            onClick: () => { if (!busy) void onDelete(entry); },
          }] }}>
            <AutomationSidebarRow title={entry.taskTitle} tooltip={entry.run.error ?? entry.taskTitle}
              disabled={busy}
              active={selectedRunId === entry.run.id}
              detail={`${formatAutomationTime(entry.run.startedAt, locale)} · ${t(`feature.automation.run.${entry.run.status}`)}`}
              onClick={() => void onSelect(entry.run.threadId, entry.taskId, entry.run.id)} />
          </Dropdown>
        ))}
      </div>
    </section>
  );
}
