import path from 'node:path';
import { convertCodexPluginManifest } from './codex-plugin-manifest.js';
import { bundlePathExists, readPluginJson } from './file-plugin-bundle-paths.js';

export const PLUGIN_MANIFEST_RELATIVE_PATH = path.join('.setsuna-plugin', 'plugin.json');
export const CODEX_PLUGIN_MANIFEST_RELATIVE_PATH = path.join('.codex-plugin', 'plugin.json');

/** Keep format differences at the input boundary; installed bundles retain their original files. */
export async function readPluginManifestSource(root: string): Promise<{
  manifestPath: string;
  record: Record<string, unknown>;
}> {
  if (await bundlePathExists(root, PLUGIN_MANIFEST_RELATIVE_PATH)) {
    return {
      manifestPath: path.join(root, PLUGIN_MANIFEST_RELATIVE_PATH),
      record: await readPluginJson(root, PLUGIN_MANIFEST_RELATIVE_PATH),
    };
  }
  if (await bundlePathExists(root, 'plugin.json')) {
    const manifest = await readPluginJson(root, 'plugin.json');
    if (typeof manifest.$schema === 'string'
      && /^https:\/\/agent-plugins\.org\/schemas\/[^/]+\/plugin\.schema\.json$/u.test(manifest.$schema)) {
      // A Codex overlay cannot stand in for the portable package's own Skills/MCP declarations.
      throw new Error('Portable Agent Plugins manifests are not supported yet. Import a .codex-plugin bundle instead.');
    }
  }
  if (await bundlePathExists(root, CODEX_PLUGIN_MANIFEST_RELATIVE_PATH)) {
    const raw = await readPluginJson(root, CODEX_PLUGIN_MANIFEST_RELATIVE_PATH);
    return {
      manifestPath: path.join(root, CODEX_PLUGIN_MANIFEST_RELATIVE_PATH),
      record: await convertCodexPluginManifest(root, raw),
    };
  }
  throw new Error(`Plugin manifest not found: ${PLUGIN_MANIFEST_RELATIVE_PATH} or ${CODEX_PLUGIN_MANIFEST_RELATIVE_PATH}`);
}
