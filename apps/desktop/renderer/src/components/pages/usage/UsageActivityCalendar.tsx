import type { RuntimeUsageBucket } from '@setsuna-desktop/contracts';
import { CalendarDays } from 'lucide-react';
import { formatTokens } from '../../workspace/model.js';
import { buildUsageCalendar } from './usageCalendar.js';

type UsageActivityCalendarProps = {
  buckets: RuntimeUsageBucket[];
};

const calendarDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function UsageActivityCalendar({ buckets }: UsageActivityCalendarProps) {
  const calendar = buildUsageCalendar(buckets);

  return (
    <section className="settings-usage-card settings-usage-calendar" aria-labelledby="settings-usage-calendar-title">
      <header className="settings-usage-card__header settings-usage-calendar__header">
        <span className="settings-usage-card__icon" aria-hidden="true">
          <CalendarDays size={16} strokeWidth={1.8} />
        </span>
        <div>
          <strong id="settings-usage-calendar-title">Token 活动</strong>
          <span>过去一年的每日消耗</span>
        </div>
        <div className="settings-usage-calendar__summary" aria-label="过去一年统计">
          <span><strong>{calendar.activeDays}</strong> 个活跃日</span>
          <span><strong>{formatTokens(calendar.averageTokensPerActiveDay)}</strong> 活跃日均</span>
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
            aria-label={`过去一年的每日 Token 活动图，共 ${calendar.activeDays} 个活跃日`}
          >
            {calendar.weeks.map((week) => (
              <div className="settings-usage-calendar__week" aria-hidden="true" key={week[0].dateKey}>
                {week.map((day) => {
                  const label = calendarDayLabel(day.dateKey, day.totalTokens, day.cachedInputTokens, day.recordCount, day.isInRange);
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
        <span>过去一年共 {formatTokens(calendar.periodTokens)} Token</span>
        <div className="settings-usage-calendar__legend" aria-label="活动强度由低到高">
          <span>少</span>
          {[0, 1, 2, 3, 4].map((level) => <i data-level={level} key={level} />)}
          <span>多</span>
        </div>
      </footer>
    </section>
  );
}

function calendarDayLabel(dateKey: string, totalTokens: number, cachedInputTokens: number, recordCount: number, isInRange: boolean): string {
  if (!isInRange) return '不在统计周期内';
  const [year, month, day] = dateKey.split('-').map(Number);
  const label = calendarDateFormatter.format(new Date(year, month - 1, day));
  if (!recordCount && !totalTokens) return `${label}，无调用`;
  const cacheLabel = cachedInputTokens > 0 ? `，缓存命中 ${formatTokens(cachedInputTokens)}` : '';
  return `${label}，${formatTokens(totalTokens)} Token${cacheLabel}，${recordCount} 次调用`;
}
