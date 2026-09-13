import { parseRuntimePluginConnectors, type RuntimePluginConnector, type RuntimePluginMcpServerDescriptor } from '@setsuna-desktop/contracts';
import { bundlePathExists, readPluginJson } from './file-plugin-bundle-paths.js';

/** A sidecar lets a Codex bundle declare setup without rewriting its upstream manifest. */
export async function readPluginConnectors(root: string, declared: unknown): Promise<RuntimePluginConnector[]> {
  const sidecar = '.setsuna-plugin/connectors.json';
  return parseRuntimePluginConnectors(declared === undefined && await bundlePathExists(root, sidecar)
    ? (await readPluginJson(root, sidecar)).connectors
    : declared);
}

export function completePluginConnectors(
  connectors: RuntimePluginConnector[],
  servers: readonly Pick<RuntimePluginMcpServerDescriptor, 'key' | 'label' | 'description'>[],
): RuntimePluginConnector[] {
  for (const connector of connectors) {
    if (connector.kind === 'mcp' && !servers.some((server) => server.key === connector.serverKey)) {
      throw new Error(`Connector ${connector.id} references an undeclared MCP server.`);
    }
  }
  const ids = new Set(connectors.map((connector) => connector.id));
  const result = [...connectors];
  for (const server of servers) {
    if (connectors.some((connector) => connector.kind === 'mcp' && connector.serverKey === server.key)) continue;
    let id = `mcp-${result.length + 1}`;
    while (ids.has(id)) id += '-mcp';
    ids.add(id);
    result.push({ id, name: server.label, description: server.description, kind: 'mcp', serverKey: server.key, required: false });
  }
  return parseRuntimePluginConnectors(result);
}
