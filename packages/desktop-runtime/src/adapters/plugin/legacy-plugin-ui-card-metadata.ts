import { parseRuntimePluginUiCardDeclarations } from '@setsuna-desktop/contracts';
import type { InstalledPluginRecord } from '../../ports/plugin-bundle-store.js';
import { readJsonFile } from '../store/json-file.js';

/**
 * A short-lived generator version wrote uiCards beside extension. Preserve a
 * read-only compatibility projection for bundles already installed that way;
 * new configure_plugin input is canonicalized before installation.
 */
export async function projectLegacyRootUiCards(
  plugin: InstalledPluginRecord,
): Promise<InstalledPluginRecord> {
  if (!plugin.extension || plugin.extension.uiCards !== undefined) return plugin;
  try {
    const manifest = await readJsonFile<Record<string, unknown>>(plugin.manifestPath, {});
    if (manifest.uiCards === undefined || !plugin.extension.capabilities.includes('ui')) return plugin;
    const uiCards = parseRuntimePluginUiCardDeclarations(manifest.uiCards);
    const toolNames = new Set((plugin.tools ?? []).map((tool) => tool.name));
    if (uiCards.some((card) => !toolNames.has(card.toolName))) return plugin;
    return { ...plugin, extension: { ...plugin.extension, uiCards } };
  } catch {
    // Malformed legacy metadata remains hidden; normal Plugin listing must stay available.
    return plugin;
  }
}
