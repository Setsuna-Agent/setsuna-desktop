import type { RuntimeMcpServer, RuntimeMcpToolInfo } from '@setsuna-desktop/contracts';

const mcpGroups = [
  ['local', 'feature.mcp.category.local'],
  ['plugin', 'feature.mcp.category.plugin'],
  ['workspace', 'feature.mcp.category.workspace'],
  ['legacy', 'feature.mcp.category.legacy'],
  ['builtin', 'feature.mcp.category.builtin'],
] as const;

export function mcpServerCategory(server: RuntimeMcpServer) {
  return server.pluginId ? 'plugin' : server.source;
}

export function groupMcpServersBySource(servers: readonly RuntimeMcpServer[]) {
  return mcpGroups.map(([id, titleKey]) => ({
    id,
    titleKey,
    servers: servers.filter((server) => mcpServerCategory(server) === id),
  })).filter(({ servers }) => servers.length > 0);
}

export function mcpConnectionPresentation(server: RuntimeMcpServer) {
  let github = false;
  try { github = new URL(server.url ?? '').origin === 'https://api.githubcopilot.com'; }
  catch { /* A missing or invalid address uses the generic service presentation. */ }
  return { github, name: github && server.label === server.key ? 'GitHub' : server.label };
}

export function mcpToolDisplayName(tool: RuntimeMcpToolInfo): string {
  if (tool.title) return tool.title;
  const name = tool.name.replace(/[_-]+/gu, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}
