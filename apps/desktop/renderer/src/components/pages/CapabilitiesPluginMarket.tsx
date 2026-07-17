import type { RuntimePluginMarketplaceItem, RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { CapabilitiesInstalledPluginListItem } from './CapabilitiesInstalledPluginListItem.js';
import { CapabilitiesPluginEditorial } from './CapabilitiesPluginEditorial.js';
import { CapabilitiesPluginListItem } from './CapabilitiesPluginListItem.js';
import { pluginMarketplacePresentation } from './pluginDisplay.js';

export function CapabilitiesPluginMarket({
  installingPluginIds,
  localPlugins,
  marketplacePlugins,
  onInstall,
  onOpenLocal,
  onOpenMarketplace,
  searching,
}: {
  installingPluginIds: Set<string>;
  localPlugins: RuntimePluginSummary[];
  marketplacePlugins: RuntimePluginMarketplaceItem[];
  onInstall: (plugin: RuntimePluginMarketplaceItem) => Promise<void>;
  onOpenLocal: (plugin: RuntimePluginSummary) => void;
  onOpenMarketplace: (plugin: RuntimePluginMarketplaceItem) => void;
  searching: boolean;
}) {
  const presentation = pluginMarketplacePresentation(marketplacePlugins, searching);

  return (
    <div className="desktop-plugin-market">
      {presentation.editorials.length ? (
        <section className="desktop-plugin-market__editorials" aria-label="编辑精选">
          {presentation.editorials.map((plugin) => (
            <CapabilitiesPluginEditorial
              key={`editorial:${plugin.id}`}
              plugin={plugin}
              installing={installingPluginIds.has(plugin.id)}
              onInstall={onInstall}
              onOpen={onOpenMarketplace}
            />
          ))}
        </section>
      ) : null}

      {presentation.sections.map((section) => (
        <section className="desktop-plugin-market__section" key={section.id}>
          <header>
            <h3>{section.title}</h3>
            <p>{section.description}</p>
          </header>
          <div className="desktop-plugin-market__list">
            {section.plugins.map((plugin) => (
              <CapabilitiesPluginListItem
                key={`marketplace:${plugin.id}`}
                plugin={plugin}
                installing={installingPluginIds.has(plugin.id)}
                onInstall={onInstall}
                onOpen={onOpenMarketplace}
              />
            ))}
          </div>
        </section>
      ))}

      {localPlugins.length ? (
        <section className="desktop-plugin-market__section">
          <header>
            <h3>本地插件</h3>
            <p>不属于当前精选市场的已安装内容</p>
          </header>
          <div className="desktop-plugin-market__list">
            {localPlugins.map((plugin) => (
              <CapabilitiesInstalledPluginListItem
                key={`local:${plugin.id}`}
                plugin={plugin}
                onOpen={onOpenLocal}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
