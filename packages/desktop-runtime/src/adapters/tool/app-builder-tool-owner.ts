import { APP_BUILDER_PLUGIN_ID, type RuntimePluginReference } from '@setsuna-desktop/contracts';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import type { ToolExecutionContext } from '../../ports/tool-host.js';

/** Native installation/data adapters belong to the bundled builder, not arbitrary same-ID bundles. */
export async function appBuilderToolOwner(
  plugins: Pick<PluginBundleStore, 'listPlugins'>,
  name: string,
  context: ToolExecutionContext,
): Promise<RuntimePluginReference | null> {
  if (context.features?.plugins === false) return null;
  const plugin = (await plugins.listPlugins()).plugins.find((item) => item.id === APP_BUILDER_PLUGIN_ID
    && item.installationSource === 'marketplace' && item.tools?.some((tool) => tool.name === name));
  return plugin ? { id: plugin.id, name: plugin.name, ...(plugin.icon ? { icon: plugin.icon } : {}) } : null;
}

export async function requireAppBuilderTool(
  plugins: Pick<PluginBundleStore, 'listPlugins'>,
  name: string,
  context: ToolExecutionContext,
): Promise<void> {
  if (!await appBuilderToolOwner(plugins, name, context)) {
    throw new Error(`App Builder tool unavailable: ${name}. Install or update the bundled App Builder plugin.`);
  }
}
