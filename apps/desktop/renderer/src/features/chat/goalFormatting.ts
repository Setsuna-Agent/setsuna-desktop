import type { RuntimeGoalExitNotice } from '@setsuna-desktop/contracts';
import type { AppLocale, Translate } from '../../shared/i18n/I18nProvider.js';

export function formatGoalDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}m ${remainder}s`;
  if (minutes) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

export function formatGoalExitSummary(
  notice: RuntimeGoalExitNotice,
  t: Translate,
  locale: AppLocale,
): string {
  const label = t(`chat.goal.exit.${notice.kind}`);
  const usage = t('chat.goal.exit.usage', {
    duration: formatGoalDuration(notice.goal.timeUsedSeconds),
    tokens: new Intl.NumberFormat(locale).format(notice.goal.tokensUsed),
  });
  return `${label} · ${usage}`;
}
