import { useI18n } from '../../../shared/i18n/I18nProvider.js';

export function ChangeCountText({ additions, deletions }: { additions: number; deletions: number }) {
  const { t } = useI18n();
  return (
    <span className="chat-change-counts" aria-label={t('chat.changeCounts', { additions, deletions })}>
      <span className="chat-change-counts__add">+{additions}</span>
      <span className="chat-change-counts__del">-{deletions}</span>
    </span>
  );
}
