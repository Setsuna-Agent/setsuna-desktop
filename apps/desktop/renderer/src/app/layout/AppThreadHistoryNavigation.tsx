import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';

export function AppThreadHistoryNavigation({
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
}) {
  const { t } = useI18n();

  return (
    <span className="app-thread-history-navigation">
      <ShortcutTooltip commandId="navigation.goBack" label={t('threadHistory.back')}>
        <IconButton
          className="app-shell-icon-control"
          disabled={!canGoBack}
          label={t('threadHistory.back')}
          title=""
          onClick={onGoBack}
        >
          <ArrowLeft size={15} />
        </IconButton>
      </ShortcutTooltip>
      <ShortcutTooltip commandId="navigation.goForward" label={t('threadHistory.forward')}>
        <IconButton
          className="app-shell-icon-control"
          disabled={!canGoForward}
          label={t('threadHistory.forward')}
          title=""
          onClick={onGoForward}
        >
          <ArrowRight size={15} />
        </IconButton>
      </ShortcutTooltip>
    </span>
  );
}
