import type { PluginBundleMutationOptions } from '../../ports/plugin-bundle-store.js';
import { inspectBundleTree, type ParsedPluginManifest } from './file-plugin-bundle-model.js';

const MARKETPLACE_ONLY_EXTENSION_CAPABILITIES = new Set(['image-generation', 'vision-recognition']);

export function assertRepositorySnapshot(options: PluginBundleMutationOptions, bundleHash: string): void {
  if (options.installationSource === 'repository' && options.repository?.bundleHash !== bundleHash) {
    throw new Error('Repository plugin changed after its catalog was loaded. Refresh the repository and try again.');
  }
}

export function assertExtensionCapabilitySource(manifest: ParsedPluginManifest, options: PluginBundleMutationOptions): void {
  const restricted = manifest.extension?.capabilities.find((capability) => MARKETPLACE_ONLY_EXTENSION_CAPABILITIES.has(capability));
  if (restricted && options.installationSource !== 'marketplace') {
    throw new Error(`Plugin extension capability is reserved for the bundled marketplace: ${restricted}`);
  }
}

export async function assertStagedBundleUnchanged(stagingPath: string, expectedHash: string): Promise<void> {
  const validatedBundle = await inspectBundleTree(stagingPath);
  if (validatedBundle.bundleHash !== expectedHash) throw new Error('Plugin bundle changed during activation validation.');
}
