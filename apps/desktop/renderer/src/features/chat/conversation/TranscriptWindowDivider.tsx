import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { ChatTimelineDivider } from './ChatTimelineDivider.js';

export function TranscriptWindowDivider({
  hiddenMessageCount,
  loading = false,
  onShowAll,
}: {
  hiddenMessageCount: number;
  loading?: boolean;
  onShowAll: () => void;
}) {
  const { t } = useI18n();
  const count = Math.max(0, hiddenMessageCount);
  return (
    <ChatTimelineDivider
      accessibilityLabel={t('chat.history.collapsedLabel')}
      label={count > 0 ? t('chat.history.collapsedCount', { count }) : t('chat.history.collapsed')}
      loading={loading}
      onClick={loading ? undefined : onShowAll}
    />
  );
}
