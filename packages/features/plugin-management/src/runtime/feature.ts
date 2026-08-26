import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  installLocalPlugin,
  installMarketplacePlugin,
  pluginManagementFeature,
  pluginManagementRuntimeHostCapability,
  readInstalledPlugins,
  readInstalledPluginItem,
  readPluginExtensionStatuses,
  readMarketplacePluginItem,
  readPluginManagementSnapshot,
  removeInstalledPlugin,
  setInstalledPluginExtensionTrust,
  updateMarketplacePlugin,
} from '../contracts/index.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(pluginManagementRuntimeHostCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
});

export const pluginManagementRuntimeFeature = defineRuntimeFeature({
  definition: pluginManagementFeature,
  dependencies,
  setup(context) {
    const { host, routes } = context.dependencies;

    routes.register(context.scope, readPluginManagementSnapshot, async () => {
      const catalogRevision = await host.catalogRevision();
      const [plugins, marketplace, extensions] = await Promise.all([
        host.listPlugins(),
        host.listMarketplace(),
        host.listExtensions(),
      ]);
      return Object.freeze({
        catalogRevision,
        extensions: Object.freeze([...extensions.extensions]),
        marketplace: Object.freeze([...marketplace.plugins]),
        marketplaceErrors: Object.freeze([...marketplace.errors]),
        plugins: Object.freeze([...plugins.plugins]),
      });
    });
    routes.register(context.scope, readPluginExtensionStatuses, async () => {
      const [catalogRevision, extensions] = await Promise.all([
        host.catalogRevision(),
        host.listExtensions(),
      ]);
      return Object.freeze({
        catalogRevision,
        extensions: Object.freeze([...extensions.extensions]),
      });
    });
    routes.register(context.scope, readInstalledPlugins, () => host.listPlugins());
    routes.register(context.scope, readInstalledPluginItem, (input) => (
      preservePluginOperationError(() => host.getInstalledItem(input))
    ));
    routes.register(context.scope, readMarketplacePluginItem, (input) => (
      preservePluginOperationError(() => host.getMarketplaceItem(input))
    ));
    routes.register(context.scope, installLocalPlugin, (input) => (
      preservePluginOperationError(() => host.installLocal(input))
    ));
    routes.register(context.scope, installMarketplacePlugin, (input) => (
      preservePluginOperationError(() => host.installMarketplace(input))
    ));
    routes.register(context.scope, updateMarketplacePlugin, (input) => (
      preservePluginOperationError(() => host.updateMarketplace(input))
    ));
    routes.register(context.scope, removeInstalledPlugin, (input) => (
      preservePluginOperationError(() => host.remove(input))
    ));
    routes.register(context.scope, setInstalledPluginExtensionTrust, (input) => (
      preservePluginOperationError(() => host.setExtensionTrust(input))
    ));
  },
});

async function preservePluginOperationError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FeatureOperationFailure) throw error;
    throw new FeatureOperationFailure({
      code: 'PLUGIN_OPERATION_FAILED',
      message: error instanceof Error && error.message.trim()
        ? error.message
        : 'Plugin operation failed.',
      retryable: false,
    });
  }
}
