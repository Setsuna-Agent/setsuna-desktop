import { Plus } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { AppTooltip, Button } from '../../shared/ui/primitives.js';
import { PluginAppCreationDialog } from './PluginAppCreationDialog.js';
import type { usePluginAppCreation } from './usePluginAppCreation.js';

export function CreatePluginAppEntry({ creation }: {
  creation: ReturnType<typeof usePluginAppCreation>;
}) {
  const { t } = useI18n();
  return <>
    <AppTooltip title={t('appCreation.title')} placement="right">
      <Button variant="ghost" className="app-navigation__button" type="button"
        aria-label={t('appCreation.title')} onClick={creation.show}>
        <Plus size={18} />
      </Button>
    </AppTooltip>
    {creation.open ? <PluginAppCreationDialog pending={creation.pending} error={creation.error}
      onClose={creation.close} onCloseAutoFocus={creation.onCloseAutoFocus}
      onSelect={(prompt) => void creation.create(prompt)} /> : null}
  </>;
}
