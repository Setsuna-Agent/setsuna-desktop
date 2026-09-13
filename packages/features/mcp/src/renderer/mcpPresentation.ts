import type { RuntimeMcpServer, RuntimeMcpToolInfo } from '@setsuna-desktop/contracts';

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
