import { ChevronRight } from 'lucide-react';
import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { CapabilitiesPluginInstallButton } from './CapabilitiesPluginInstallButton.js';
import { pluginCapabilitySummary } from './pluginDisplay.js';

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
  return (
    <article className="desktop-plugin-editorial" data-plugin-id={plugin.id}>
      <button className="desktop-plugin-editorial__copy" type="button" onClick={() => onOpen(plugin)}>
        <strong className="desktop-plugin-editorial__title">{plugin.name}</strong>
        <span className="desktop-plugin-editorial__description">{plugin.description || '为 Setsuna 加入一种新的工作方式。'}</span>
      </button>
      <div className="desktop-plugin-editorial__art" aria-hidden="true">
        <span className="desktop-plugin-editorial__halo" />
        <span className="desktop-plugin-editorial__track" />
        <CapabilitiesPluginIcon name={plugin.icon} variant="editorial" />
      </div>
      <footer>
        <span>{pluginCapabilitySummary(plugin)}</span>
        <div>
          <button className="desktop-plugin-editorial__details" type="button" onClick={() => onOpen(plugin)}>
            详情 <ChevronRight size={13} />
          </button>
          <CapabilitiesPluginInstallButton plugin={plugin} installing={installing} onInstall={onInstall} />
        </div>
      </footer>
    </article>
  );
}
