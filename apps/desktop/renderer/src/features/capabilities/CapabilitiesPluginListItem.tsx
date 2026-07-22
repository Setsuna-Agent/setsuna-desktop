import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { CapabilitiesPluginInstallButton } from './CapabilitiesPluginInstallButton.js';
import { pluginCapabilitySummary } from './pluginDisplay.js';
import { localizedPluginCopy } from './pluginLocalization.js';

export function CapabilitiesPluginListItem({
  installing,
  onInstall,
  onOpen,
  plugin,
}: {
  installing: boolean;
  onInstall: (plugin: RuntimePluginMarketplaceItem) => Promise<void>;
  onOpen: (plugin: RuntimePluginMarketplaceItem) => void;
  plugin: RuntimePluginMarketplaceItem;
}) {
  const { t } = useI18n();
  const copy = localizedPluginCopy(plugin, t);
  return (
    <article className="desktop-plugin-list-item">
      <button className="desktop-plugin-list-item__identity" type="button" onClick={() => onOpen(plugin)}>
        <CapabilitiesPluginIcon name={plugin.icon} variant="list" />
        <span className="desktop-plugin-list-item__copy">
          <strong>{copy.name}</strong>
          <span>{copy.description || t('capabilities.market.listFallback')}</span>
          <small>{plugin.publisher || 'Setsuna'} · {pluginCapabilitySummary(plugin, t)}</small>
        </span>
      </button>
      <CapabilitiesPluginInstallButton plugin={plugin} installing={installing} onInstall={onInstall} />
    </article>
  );
}
