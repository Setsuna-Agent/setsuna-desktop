import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { localizedPluginCopy } from './pluginLocalization.js';

export function CapabilitiesPluginInstallButton({
  installing,
  onInstall,
  plugin,
}: {
  installing: boolean;
  onInstall: (plugin: RuntimePluginMarketplaceItem) => Promise<void>;
  plugin: RuntimePluginMarketplaceItem;
}) {
  const { t } = useI18n();
  const copy = localizedPluginCopy(plugin, t);
  const updateAvailable = plugin.installed && plugin.updateAvailable;
  const disabled = (plugin.installed && !updateAvailable) || installing;
  const label = installing
    ? t(updateAvailable ? 'capabilities.market.updating' : 'capabilities.market.getting')
    : updateAvailable ? t('capabilities.market.update')
      : plugin.installed ? t('capabilities.market.installed') : t('capabilities.market.get');

  return (
    <button
      className={`desktop-plugin-market__get${plugin.installed && !updateAvailable ? ' is-installed' : ''}`}
      type="button"
      aria-label={t('capabilities.market.actionLabel', { action: label, name: copy.name })}
      disabled={disabled}
      onClick={() => void onInstall(plugin)}
    >
      {installing ? <Loader2 className="is-spinning" size={13} /> : null}
      <span>{label}</span>
    </button>
  );
}
