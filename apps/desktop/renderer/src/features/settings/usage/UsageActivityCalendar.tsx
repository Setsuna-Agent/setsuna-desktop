import type { RuntimeUsageBucket } from '@setsuna-desktop/contracts';
import { CalendarDays } from 'lucide-react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { formatTokens } from '../../workspace/model.js';
import { buildUsageCalendar } from './usageCalendar.js';

type UsageActivityCalendarProps = {
  buckets: RuntimeUsageBucket[];
};

export function UsageActivityCalendar({ buckets }: UsageActivityCalendarProps) {
  const { locale, t } = useI18n();
  const calendar = buildUsageCalendar(buckets, new Date(), locale);
  const calendarDateFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <section className="settings-usage-card settings-usage-calendar" aria-labelledby="settings-usage-calendar-title">
      <header className="settings-usage-card__header settings-usage-calendar__header">
        <span className="settings-usage-card__icon" aria-hidden="true">
          <CalendarDays size={16} strokeWidth={1.8} />
        </span>
        <div>
          <strong id="settings-usage-calendar-title">{t('settings.usage.activity')}</strong>
          <span>{t('settings.usage.activitySubtitle')}</span>
        </div>
        <div className="settings-usage-calendar__summary" aria-label={t('settings.usage.yearStats')}>
          <span>{t('settings.usage.activeDays', { count: calendar.activeDays })}</span>
          <span>{t('settings.usage.averageActiveDay', { tokens: formatTokens(calendar.averageTokensPerActiveDay) })}</span>
        </div>
      </header>
      <div className="settings-usage-calendar__scroller">
        <div className="settings-usage-calendar__canvas">
          <div className="settings-usage-calendar__months" aria-hidden="true">
            {calendar.months.map((month) => (
              <span key={`${month.weekIndex}-${month.label}`} style={{ gridColumnStart: month.weekIndex + 1 }}>{month.label}</span>
            ))}
          </div>
          <div
            className="settings-usage-calendar__grid"
            role="img"
            aria-label={t('settings.usage.activityChart', { count: calendar.activeDays })}
          >
            {calendar.weeks.map((week) => (
              <div className="settings-usage-calendar__week" aria-hidden="true" key={week[0].dateKey}>
                {week.map((day) => {
                  const label = calendarDayLabel(day.dateKey, day.totalTokens, day.cachedInputTokens, day.recordCount, day.isInRange, calendarDateFormatter, t);
                  return (
                    <span
                      className={`settings-usage-calendar__day${day.isInRange ? '' : ' is-outside'}`}
                      data-level={day.level}
                      key={day.dateKey}
                      title={label}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer className="settings-usage-calendar__footer">
        <span>{t('settings.usage.periodTotal', { tokens: formatTokens(calendar.periodTokens) })}</span>
        <div className="settings-usage-calendar__legend" aria-label={t('settings.usage.intensity')}>
          <span>{t('settings.usage.less')}</span>
          {[0, 1, 2, 3, 4].map((level) => <i data-level={level} key={level} />)}
          <span>{t('settings.usage.more')}</span>
        </div>
      </footer>
    </section>
  );
}

function calendarDayLabel(dateKey: string, totalTokens: number, cachedInputTokens: number, recordCount: number, isInRange: boolean, formatter: Intl.DateTimeFormat, t: Translate): string {
  if (!isInRange) return t('settings.usage.outsidePeriod');
  const [year, month, day] = dateKey.split('-').map(Number);
  const label = formatter.format(new Date(year, month - 1, day));
  if (!recordCount && !totalTokens) return t('settings.usage.noCallsOnDate', { date: label });
  const cacheLabel = cachedInputTokens > 0 ? t('settings.usage.cacheOnDate', { tokens: formatTokens(cachedInputTokens) }) : '';
  return t('settings.usage.dayDetails', { date: label, tokens: formatTokens(totalTokens), cache: cacheLabel, count: recordCount });
}
