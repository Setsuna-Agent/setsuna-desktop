import type { RuntimePluginMarketplaceItem, RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { CapabilitiesInstalledPluginShortcut } from './CapabilitiesInstalledPluginShortcut.js';
import { CapabilitiesPluginListItem } from './CapabilitiesPluginListItem.js';
import { pluginMarketplacePresentation } from './pluginDisplay.js';

export function CapabilitiesPluginMarket({
  installingPluginIds,
  legacyHooksPlugin,
  localPlugins,
  marketplacePlugins,
  onInstall,
  onOpenLegacyHooks,
  onOpenLocal,
  onOpenMarketplace,
}: {
  installingPluginIds: Set<string>;
  legacyHooksPlugin?: RuntimePluginSummary;
  localPlugins: RuntimePluginSummary[];
  marketplacePlugins: RuntimePluginMarketplaceItem[];
  onInstall: (plugin: RuntimePluginMarketplaceItem) => Promise<void>;
  onOpenLegacyHooks?: () => void;
  onOpenLocal: (plugin: RuntimePluginSummary) => void;
  onOpenMarketplace: (plugin: RuntimePluginMarketplaceItem) => void;
}) {
  const { t } = useI18n();
  const presentation = pluginMarketplacePresentation(marketplacePlugins, t);
  const installedMarketplacePlugins = marketplacePlugins.filter((plugin) => plugin.installed);
  const installedCount = installedMarketplacePlugins.length + localPlugins.length + Number(Boolean(legacyHooksPlugin));

  return (
    <div className="desktop-plugin-market">
      {installedCount ? (
        <section className="desktop-plugin-market__installed" aria-label={t('capabilities.market.installed')}>
          <header>
            <h3>{t('capabilities.market.installed')}</h3>
            <span>{t('capabilities.market.installedCount', { count: installedCount })}</span>
          </header>
          <div className="desktop-plugin-market__installed-list">
            {installedMarketplacePlugins.map((plugin) => (
              <CapabilitiesInstalledPluginShortcut
                key={`installed-marketplace:${plugin.id}`}
                plugin={plugin}
                onOpen={() => onOpenMarketplace(plugin)}
              />
            ))}
            {localPlugins.map((plugin) => (
              <CapabilitiesInstalledPluginShortcut
                key={`installed-local:${plugin.id}`}
                plugin={plugin}
                onOpen={() => onOpenLocal(plugin)}
              />
            ))}
            {legacyHooksPlugin && onOpenLegacyHooks ? (
              <CapabilitiesInstalledPluginShortcut
                key="installed-legacy-hooks"
                plugin={legacyHooksPlugin}
                onOpen={onOpenLegacyHooks}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="desktop-plugin-market__catalog">
        {presentation.sections.map((section) => (
          <section className="desktop-plugin-market__section" key={section.id}>
            <header>
              <h3>{section.title}</h3>
              <p>{section.description}</p>
            </header>
            <div className="desktop-plugin-market__list desktop-capability-list">
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
      </div>
    </div>
  );
}
