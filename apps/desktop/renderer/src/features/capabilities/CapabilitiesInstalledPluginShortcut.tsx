import type { RuntimePluginMarketplaceItem, RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { localizedPluginCopy } from './pluginLocalization.js';

export function CapabilitiesInstalledPluginShortcut({
  onOpen,
  plugin,
}: {
  onOpen: () => void;
  plugin: RuntimePluginMarketplaceItem | RuntimePluginSummary;
}) {
  const { t } = useI18n();
  const copy = localizedPluginCopy(plugin, t);
  const updateAvailable = 'updateAvailable' in plugin && plugin.updateAvailable;

  return (
    <article className={`desktop-plugin-installed-shortcut${updateAvailable ? ' has-update' : ''}`}>
      <button
        type="button"
        aria-label={t('capabilities.market.openInstalled', { name: copy.name })}
        onClick={onOpen}
      >
        <CapabilitiesPluginIcon name={plugin.icon} variant="installed" />
        {updateAvailable ? <span className="desktop-plugin-installed-shortcut__update" aria-hidden="true" /> : null}
      </button>
      <span className="desktop-plugin-installed-shortcut__name" aria-hidden="true">
        {copy.name}
      </span>
    </article>
  );
}
