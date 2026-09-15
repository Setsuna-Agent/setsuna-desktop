import type { RuntimePluginReference, RuntimePluginSummary, RuntimeToolDefinition } from '@setsuna-desktop/contracts';

/** Attach installed provenance only after permissions have filtered the live catalog. */
export function withToolDiscoverySource(
  tool: RuntimeToolDefinition,
  owner: RuntimePluginReference | undefined,
  plugins: RuntimePluginSummary[],
): RuntimeToolDefinition {
  const source = owner
    ? { kind: 'extension' as const, id: owner.id, name: owner.name, plugins: [owner] }
    : tool.source;
  if (!source) return tool;
  const associated = plugins.filter((plugin) => source.kind === 'mcp'
    ? plugin.mcpServers.some((server) => server.key === source.id)
    : plugin.id === owner?.id);
  const references = new Map((source.plugins ?? []).map((plugin) => [plugin.id, plugin]));
  for (const { id, name } of associated) references.set(id, { id, name });
  const description = [...new Set([source.description, ...associated.map((plugin) => plugin.description)]
    .filter((value): value is string => Boolean(value?.trim())))].join('\n');
  return {
    ...tool,
    source: {
      ...source,
      ...(description ? { description } : {}),
      ...(references.size ? { plugins: [...references.values()] } : {}),
    },
  };
}
