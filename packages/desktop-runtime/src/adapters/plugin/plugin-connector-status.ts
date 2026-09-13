import type { RuntimePluginConnector, RuntimePluginConnectorStatus, RuntimeMcpServer } from '@setsuna-desktop/contracts';
import type { McpControl } from '@setsuna-desktop/feature-mcp/contracts';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';

export async function readPluginConnectorStatuses(
  pluginId: string,
  plugins: Pick<PluginBundleStore, 'listPlugins'>,
  mcp: Pick<McpControl, 'listServers'>,
  findCommand = connectorCommandExists,
): Promise<RuntimePluginConnectorStatus[]> {
  const plugin = (await plugins.listPlugins()).plugins.find((item) => item.id === pluginId);
  if (!plugin) throw new Error('Plugin is not installed.');
  const connectors = plugin.connectors ?? [];
  // Listing configuration/auth metadata does not start a stdio server or run plugin setup commands.
  const servers = connectors.some((connector) => connector.kind === 'mcp')
    ? await mcp.listServers({ includeAuthStatus: true }).catch(() => null) : { servers: [] };
  return Promise.all(connectors.map(async (connector): Promise<RuntimePluginConnectorStatus> => {
    try {
      const state = connector.kind === 'cli'
        ? await findCommand(connector.command) ? 'installed' : 'missing'
        : servers ? mcpState(connector, servers.servers) : 'error';
      return { connectorId: connector.id, state };
    } catch {
      return { connectorId: connector.id, state: 'error' };
    }
  }));
}

function mcpState(connector: Extract<RuntimePluginConnector, { kind: 'mcp' }>, servers: RuntimeMcpServer[]): RuntimePluginConnectorStatus['state'] {
  const server = servers.find((item) => item.key === connector.serverKey);
  if (!server) return 'missing';
  if (!server.enabled) return 'disabled';
  if (server.authStatus === 'oAuthError' || server.authStatus === 'configurationError') return 'error';
  if (server.authStatus === 'notLoggedIn' || server.authStatus === 'oAuthExpired') return 'needs-auth';
  return 'configured';
}

/** Resolve names on the runtime PATH without executing package-supplied commands or returning host paths. */
export async function connectorCommandExists(
  command: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(command)) return false;
  const getEnv = (key: string) => environment[Object.keys(environment).find((item) => (
    platform === 'win32' ? item.toUpperCase() === key : item === key
  )) ?? key];
  const extensions = platform === 'win32' && !path.extname(command)
    ? (getEnv('PATHEXT') ?? '.EXE;.CMD;.BAT;.COM').split(';').filter((value) => /^\.[a-z]+$/iu.test(value))
    : [''];
  const directories = (getEnv('PATH') ?? '').split(platform === 'win32' ? ';' : ':');
  for (const entry of directories) {
    const directory = entry.replace(/^"|"$/gu, '');
    if (!path.isAbsolute(directory)) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        if (!(await stat(candidate)).isFile()) continue;
        await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return true;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }
  }
  return false;
}
