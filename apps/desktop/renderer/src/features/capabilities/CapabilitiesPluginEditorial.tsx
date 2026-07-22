import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { CapabilitiesPluginInstallButton } from './CapabilitiesPluginInstallButton.js';
import { pluginCapabilitySummary } from './pluginDisplay.js';
import { localizedPluginCopy } from './pluginLocalization.js';

export function CapabilitiesPluginEditorial({
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
    <article className="desktop-plugin-editorial" data-plugin-id={plugin.id}>
      <button className="desktop-plugin-editorial__copy" type="button" onClick={() => onOpen(plugin)}>
        <strong className="desktop-plugin-editorial__title">{copy.name}</strong>
        <span className="desktop-plugin-editorial__description">{copy.description || t('capabilities.market.editorialFallback')}</span>
      </button>
      <div className="desktop-plugin-editorial__art" aria-hidden="true">
        <span className="desktop-plugin-editorial__halo" />
        <span className="desktop-plugin-editorial__track" />
        <CapabilitiesPluginIcon name={plugin.icon} variant="editorial" />
      </div>
      <footer>
        <span>{pluginCapabilitySummary(plugin, t)}</span>
        <div>
          <button className="desktop-plugin-editorial__details" type="button" onClick={() => onOpen(plugin)}>
            {t('capabilities.market.details')} <ChevronRight size={13} />
          </button>
          <CapabilitiesPluginInstallButton plugin={plugin} installing={installing} onInstall={onInstall} />
        </div>
      </footer>
    </article>
  );
}
