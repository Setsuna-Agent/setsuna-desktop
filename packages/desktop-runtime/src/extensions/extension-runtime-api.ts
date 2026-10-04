import type { RuntimeApiResponse, RuntimePluginUiRuntimeRequest } from '@setsuna-desktop/contracts';
import type { InstalledPluginRecord, PluginBundleStore } from '../ports/plugin-bundle-store.js';
import type { RuntimeApi } from '../ports/runtime-api.js';

export async function requestPluginRuntimeApi(
  input: RuntimePluginUiRuntimeRequest,
  host: {
    api?: RuntimeApi;
    plugins: Pick<PluginBundleStore, 'listInstalledRecords'>;
    verify(plugin: InstalledPluginRecord): Promise<void>;
  },
  signal?: AbortSignal,
): Promise<RuntimeApiResponse> {
  signal?.throwIfAborted();
  const plugin = (await host.plugins.listInstalledRecords()).find((item) => item.id === input.pluginId);
  if (!plugin?.extension?.capabilities.includes('ui')) throw new Error('Plugin application is not installed.');
  const contribution = plugin.extension.rendererUi?.contributions.find((item) => item.id === input.contributionId);
  if (contribution?.slot !== 'renderer.plugin.page' || !contribution.document) {
    throw new Error('Runtime API access requires an installed sidebar application.');
  }
  // Identity is bound by the renderer host. Recheck the installed hash on every
  // request so a page left open cannot retain access after trust is revoked.
  await host.verify(plugin);
  if (!host.api) throw new Error('Runtime API transport is unavailable.');
  return host.api.request(input.request, signal);
}
