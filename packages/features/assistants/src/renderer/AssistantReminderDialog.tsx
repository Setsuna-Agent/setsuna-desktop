import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dialog } from '@setsuna-desktop/renderer-ui';
import type { AssistantReminder } from '../contracts/index.js';

export function AssistantReminderDialog({ reminder, busy, translate: t, onClose, onDelete, onOpenLastRun }: {
  reminder: AssistantReminder; busy: boolean; translate: RendererTranslate;
  onClose(): void; onDelete(): void; onOpenLastRun(): void;
}) {
  return <Dialog title={reminder.title} width={560} onClose={onClose} dismissible={!busy}
    footer={<>
      <Button variant="danger" className="assistant-reminder__delete" loading={busy} onClick={onDelete}>
        {t('feature.assistants.sidebar.delete')}
      </Button>
      {reminder.lastRun?.turnId ? <Button disabled={busy} onClick={onOpenLastRun}>
        {t('feature.assistants.reminder.openLastRun')}
      </Button> : null}
    </>}>
    <dl className="assistant-reminder__details">
      <div><dt>{t('feature.assistants.reminder.instructions')}</dt><dd>{reminder.instructions}</dd></div>
      <div><dt>{t('feature.assistants.reminder.schedule')}</dt><dd>{formatSchedule(reminder.schedule, t)}</dd></div>
      <div><dt>{t('feature.assistants.reminder.status')}</dt><dd>{t(`feature.assistants.reminder.${reminder.status}`)}</dd></div>
      {reminder.nextRunAt ? <div><dt>{t('feature.assistants.reminder.nextRun')}</dt>
        <dd><time dateTime={reminder.nextRunAt}>{new Date(reminder.nextRunAt).toLocaleString()}</time></dd>
      </div> : null}
    </dl>
  </Dialog>;
}

function formatSchedule(schedule: AssistantReminder['schedule'], t: RendererTranslate): string {
  if (schedule.kind === 'once') return new Date(schedule.at).toLocaleString();
  if (schedule.kind === 'interval') return t('feature.assistants.reminder.everyMinutes', { minutes: schedule.minutes });
  const days = 'weekdays' in schedule
    ? schedule.weekdays.map((day) => t(`feature.assistants.reminder.day.${day}`)).join(' / ')
    : t(`feature.assistants.reminder.${schedule.kind}`);
  return `${days} ${schedule.time} (${schedule.timeZone})`;
}
