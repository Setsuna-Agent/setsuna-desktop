import { memo } from 'react';
import { useI18n } from '../../../../shared/i18n/I18nProvider.js';

export const ChatMessageTimestamp = memo(function ChatMessageTimestamp({ value, previous }: { value?: string; previous?: string }) {
  const { locale } = useI18n();
  if (!value) return null;
  const date = new Date(value);
  const prior = previous ? new Date(previous) : null;
  if (!Number.isFinite(date.getTime())) return null;
  if (prior && date.toDateString() === prior.toDateString() && Math.abs(date.getTime() - prior.getTime()) < 5 * 60_000) return null;
  const label = new Intl.DateTimeFormat(locale, {
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
  return <time className="chat-message-timestamp" dateTime={value} title={date.toLocaleString(locale)}>{label}</time>;
});
