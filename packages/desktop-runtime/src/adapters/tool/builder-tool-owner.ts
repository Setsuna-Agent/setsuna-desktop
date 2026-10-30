import { isBuiltinBuilderPlugin, type RuntimePluginReference } from '@setsuna-desktop/contracts';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import type { ToolExecutionContext } from '../../ports/tool-host.js';

/** Both builders share native adapters; selected identity only controls tool attribution. */
export async function builderToolOwner(
  plugins: Pick<PluginBundleStore, 'listPlugins'>,
  name: string,
  context: ToolExecutionContext,
): Promise<RuntimePluginReference | null> {
  if (context.features?.plugins === false) return null;
  const builders = (await plugins.listPlugins()).plugins.filter((item) => isBuiltinBuilderPlugin(item)
    && item.tools?.some((tool) => tool.name === name));
  const plugin = builders.find((item) => context.selectedPluginIds?.includes(item.id)) ?? builders[0];
  return plugin ? { id: plugin.id, name: plugin.name, ...(plugin.icon ? { icon: plugin.icon } : {}) } : null;
}

export async function requireBuilderTool(
  plugins: Pick<PluginBundleStore, 'listPlugins'>,
  name: string,
  context: ToolExecutionContext,
): Promise<void> {
  if (!await builderToolOwner(plugins, name, context)) {
    throw new Error(`Builder tool unavailable: ${name}. Install or update the bundled App Builder or Plugin Builder plugin.`);
  }
}
