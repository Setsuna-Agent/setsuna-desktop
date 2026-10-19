import type { RuntimeUsageBucket } from '../../contracts/index.js';
import { buildUsageCalendar } from './usageCalendar.js';
import { formatTokens, usageDayDetails } from './usage-format.js';
import { useUsageView } from './view-context.js';

type UsageActivityCalendarProps = {
  buckets: readonly RuntimeUsageBucket[];
};

export function UsageActivityCalendar({ buckets }: UsageActivityCalendarProps) {
  const { host: { Tooltip }, locale, translate: t } = useUsageView();
  const calendar = buildUsageCalendar(buckets, new Date(), locale);
  const dayFormatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const stats = [
    { key: 'active', label: t('feature.usage.activeDaysLabel'), value: t('feature.usage.dayUnit', { count: calendar.activeDays }) },
    { key: 'streak', label: t('feature.usage.longestStreak'), value: t('feature.usage.dayUnit', { count: calendar.longestStreakDays }) },
    { key: 'average', label: t('feature.usage.averageActiveDayLabel'), value: formatTokens(calendar.averageTokensPerActiveDay) },
    { key: 'total', label: t('feature.usage.yearTotal'), value: formatTokens(calendar.periodTokens) },
  ];

  return (
    <section className="settings-usage-card settings-usage-calendar" aria-labelledby="settings-usage-calendar-title">
      <header className="settings-usage-card__header">
        <span className="settings-usage-eyebrow" id="settings-usage-calendar-title">{t('feature.usage.activity')}</span>
        <span className="settings-usage-card__meta">{t('feature.usage.activitySubtitle')}</span>
      </header>
      <dl className="settings-usage-calendar__stats" aria-label={t('feature.usage.yearStats')}>
        {stats.map((stat) => (
          <div key={stat.key}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>
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
                {week.map((day) => (
                  <Tooltip key={day.dateKey} title={day.isInRange ? usageDayDetails(day, dayFormatter, t) : t('feature.usage.outsidePeriod')}>
                    <span
                      className={`settings-usage-calendar__day${day.isInRange ? '' : ' is-outside'}`}
                      data-level={day.level}
                    />
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer className="settings-usage-calendar__footer">
        <div className="settings-usage-calendar__legend" aria-label={t('feature.usage.intensity')}>
          <span>{t('feature.usage.less')}</span>
          {[0, 1, 2, 3, 4].map((level) => <i data-level={level} key={level} />)}
          <span>{t('feature.usage.more')}</span>
        </div>
      </footer>
    </section>
  );
}
