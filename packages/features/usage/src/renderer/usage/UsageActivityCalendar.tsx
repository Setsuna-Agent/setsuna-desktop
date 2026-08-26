import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { RuntimeUsageBucket } from '../../contracts/index.js';
import { buildUsageCalendar } from './usageCalendar.js';
import { formatTokens } from './usage-format.js';
import { useUsageView } from './view-context.js';

type UsageActivityCalendarProps = {
  buckets: readonly RuntimeUsageBucket[];
};

export function UsageActivityCalendar({ buckets }: UsageActivityCalendarProps) {
  const { host: { Tooltip }, locale, translate } = useUsageView();
  const t = translate;
  const calendar = buildUsageCalendar(buckets, new Date(), locale);
  const calendarDateFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <section className="settings-usage-card settings-usage-calendar" aria-labelledby="settings-usage-calendar-title">
      <header className="settings-usage-card__header settings-usage-card__header--plain settings-usage-calendar__header">
        <div>
          <strong id="settings-usage-calendar-title">{t('feature.usage.activity')}</strong>
          <span>{t('feature.usage.activitySubtitle')}</span>
        </div>
        <div className="settings-usage-calendar__summary" aria-label={t('feature.usage.yearStats')}>
          <span>{t('feature.usage.activeDays', { count: calendar.activeDays })}</span>
          <span>{t('feature.usage.averageActiveDay', { tokens: formatTokens(calendar.averageTokensPerActiveDay) })}</span>
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
            aria-label={t('feature.usage.activityChart', { count: calendar.activeDays })}
          >
            {calendar.weeks.map((week) => (
              <div className="settings-usage-calendar__week" aria-hidden="true" key={week[0].dateKey}>
                {week.map((day) => {
                  const label = calendarDayLabel(day.dateKey, day.totalTokens, day.cachedInputTokens, day.recordCount, day.isInRange, calendarDateFormatter, t);
                  return (
                    <Tooltip key={day.dateKey} title={label}>
                      <span
                        className={`settings-usage-calendar__day${day.isInRange ? '' : ' is-outside'}`}
                        data-level={day.level}
                      />
                    </Tooltip>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer className="settings-usage-calendar__footer">
        <span>{t('feature.usage.periodTotal', { tokens: formatTokens(calendar.periodTokens) })}</span>
        <div className="settings-usage-calendar__legend" aria-label={t('feature.usage.intensity')}>
          <span>{t('feature.usage.less')}</span>
          {[0, 1, 2, 3, 4].map((level) => <i data-level={level} key={level} />)}
          <span>{t('feature.usage.more')}</span>
        </div>
      </footer>
    </section>
  );
}

function calendarDayLabel(dateKey: string, totalTokens: number, cachedInputTokens: number, recordCount: number, isInRange: boolean, formatter: Intl.DateTimeFormat, t: RendererTranslate): string {
  if (!isInRange) return t('feature.usage.outsidePeriod');
  const [year, month, day] = dateKey.split('-').map(Number);
  const label = formatter.format(new Date(year, month - 1, day));
  if (!recordCount && !totalTokens) return t('feature.usage.noCallsOnDate', { date: label });
  const cacheLabel = cachedInputTokens > 0 ? t('feature.usage.cacheOnDate', { tokens: formatTokens(cachedInputTokens) }) : '';
  return t('feature.usage.dayDetails', { date: label, tokens: formatTokens(totalTokens), cache: cacheLabel, count: recordCount });
}
