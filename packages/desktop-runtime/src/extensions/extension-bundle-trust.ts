import { inspectBundleTree } from '../adapters/plugin/file-plugin-bundle-model.js';
import type { InstalledPluginRecord } from '../ports/plugin-bundle-store.js';

export type ExtensionBundleTrustResolver = (
  plugin: InstalledPluginRecord,
) => Promise<string | null>;

/** Verifies the exact installed snapshot without activating third-party code. */
export async function trustedExtensionBundleHash(
  plugin: InstalledPluginRecord,
): Promise<string | null> {
  const extension = plugin.extension;
  if (!extension?.trustedHash) return null;
  const bundle = await inspectBundleTree(plugin.installPath);
  return extension.trustedHash === bundle.bundleHash ? bundle.bundleHash : null;
}

/** Coalesces only concurrent checks; later calls still re-hash to detect disk changes. */
export class ExtensionBundleTrustCoordinator {
  private readonly inFlight = new Map<string, Map<string, Promise<string | null>>>();

  constructor(
    private readonly resolve: ExtensionBundleTrustResolver = trustedExtensionBundleHash,
  ) {}

  verify(plugin: InstalledPluginRecord): Promise<string | null> {
    const extension = plugin.extension;
    const revision = JSON.stringify([
      plugin.installPath,
      extension?.bundleHash ?? null,
      extension?.trustedHash ?? null,
    ]);
    let pluginChecks = this.inFlight.get(plugin.id);
    const current = pluginChecks?.get(revision);
    if (current) return current;

    if (!pluginChecks) {
      pluginChecks = new Map();
      this.inFlight.set(plugin.id, pluginChecks);
    }
    const promise = Promise.resolve().then(() => this.resolve(plugin));
    pluginChecks.set(revision, promise);
    const clear = () => {
      const currentChecks = this.inFlight.get(plugin.id);
      if (currentChecks?.get(revision) !== promise) return;
      currentChecks.delete(revision);
      if (!currentChecks.size) this.inFlight.delete(plugin.id);
    };
    void promise.then(clear, clear);
    return promise;
  }

  invalidate(pluginId: string): void {
    this.inFlight.delete(pluginId);
  }
}
