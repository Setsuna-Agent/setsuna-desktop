import type { InstalledPluginRecord } from '../../ports/plugin-bundle-store.js';
import { readJsonFile } from '../store/json-file.js';

export async function readMcpPluginOwners(indexPath: string): Promise<Map<string, string>> {
  try {
    const index = await readJsonFile<{ plugins: Pick<InstalledPluginRecord, 'id' | 'mcpServers'>[] }>(
      indexPath, { plugins: [] },
    );
    return new Map(index.plugins.flatMap((plugin) => (
      plugin.mcpServers.filter(({ owned }) => owned).map(({ key }) => [key, plugin.id] as const)
    )));
  } catch {
    // Optional catalog provenance must not prevent reading or editing MCP configuration.
    return new Map();
  }
}
