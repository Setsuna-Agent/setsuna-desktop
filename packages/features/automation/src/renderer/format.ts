import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { AutomationSchedule } from '../contracts/index.js';

export function formatSchedule(schedule: AutomationSchedule, translate: RendererTranslate, locale: string): string {
  if (schedule.kind === 'once') return formatAutomationTime(schedule.at, locale);
  if (schedule.kind === 'interval') return translate('feature.automation.everyMinutes', { minutes: schedule.minutes });
  const days = schedule.kind === 'weekly' || schedule.kind === 'custom'
    ? schedule.weekdays.map((day) => translate(`feature.automation.day.${day}`)).join('、')
    : translate(`feature.automation.${schedule.kind}`);
  return `${days} ${schedule.time}`;
}

export function formatAutomationTime(at: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
}
