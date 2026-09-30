import { Pause, Play, RotateCw, Settings2, Trash2 } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown } from '@setsuna-desktop/renderer-ui';
import type { AutomationTask } from '../contracts/index.js';
import { formatAutomationTime, formatSchedule } from './format.js';
import type { AutomationTaskActions } from './useAutomationTaskActions.js';
import { AutomationSidebarRow } from './AutomationSidebarRow.js';

export function AutomationTaskRow({ task, active, busy, actions, onSelect, translate: t, locale }: {
  task: AutomationTask; active: boolean; busy: boolean; actions: AutomationTaskActions;
  onSelect(threadId: string, taskId: string): Promise<void>; translate: RendererTranslate; locale: string;
}) {
  const running = task.runs.some((run) => run.status === 'running');
  return <Dropdown trigger={['contextMenu']} disabled={busy} menu={{ items: [
    { key: 'edit', label: t('feature.automation.edit'), icon: <Settings2 size={15} /> },
    { key: 'status', label: t(task.status === 'active' ? 'feature.automation.pause' : 'feature.automation.resume'), icon: task.status === 'active' ? <Pause size={15} /> : <Play size={15} /> },
    { key: 'run', label: t('feature.automation.run'), icon: <RotateCw size={15} />, disabled: running },
    { type: 'divider' },
    { key: 'delete', label: t('feature.automation.delete'), icon: <Trash2 size={15} />, danger: true, disabled: running },
  ], onClick: ({ key }) => {
    if (busy) return;
    if (key === 'edit') actions.edit(task);
    else if (key === 'status') void actions.toggleStatus(task);
    else if (key === 'run') void actions.run(task);
    else if (key === 'delete') void actions.remove(task);
  } }}>
    <AutomationSidebarRow title={task.title} active={active} disabled={busy}
      detail={`${task.status === 'active' && task.nextRunAt ? formatAutomationTime(task.nextRunAt, locale) : t(`feature.automation.status.${task.status}`)} · ${formatSchedule(task.schedule, t, locale)}`}
      onClick={() => void onSelect(task.conversationThreadId, task.id)} />
  </Dropdown>;
}
