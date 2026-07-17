import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { CapabilitiesPluginInstallButton } from './CapabilitiesPluginInstallButton.js';
import { pluginCapabilitySummary } from './pluginDisplay.js';

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
  return (
    <article className="desktop-plugin-list-item">
      <button className="desktop-plugin-list-item__identity" type="button" onClick={() => onOpen(plugin)}>
        <CapabilitiesPluginIcon name={plugin.icon} variant="list" />
        <span className="desktop-plugin-list-item__copy">
          <strong>{plugin.name}</strong>
          <span>{plugin.description || '为 Setsuna 加入新的能力。'}</span>
          <small>{plugin.publisher || 'Setsuna'} · {pluginCapabilitySummary(plugin)}</small>
        </span>
      </button>
      <CapabilitiesPluginInstallButton plugin={plugin} installing={installing} onInstall={onInstall} />
    </article>
  );
}
