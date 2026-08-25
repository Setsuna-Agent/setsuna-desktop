import { Gauge } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function RuntimeActivityMenuItem({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();

  return (
    <button type="button" role="menuitem" aria-haspopup="dialog" onClick={onClick}>
      <Gauge size={13} />
      {t('runtimeActivity.title')}
    </button>
  );
}
