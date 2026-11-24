import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { designMcpName, type DesignMcpClient } from '../../contracts/design-mcp.js';

export { designMcpName };
export const designMcpEntry = 'design-mcp.cjs';
export type DesignMcpStdio = Readonly<{ command: string; args: [string, string]; env: { ELECTRON_RUN_AS_NODE: '1' } }>;
export type DesignMcpConfigAction = 'enable' | 'restore' | 'disable';

export function designMcpClientFiles(home: string, env: NodeJS.ProcessEnv): Record<DesignMcpClient, string> {
  return {
    codex: join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'),
    'claude-code': join(env.CLAUDE_CONFIG_DIR || home, '.claude.json'),
  };
}

function designMcpEndpoint(value: unknown): string | undefined {
  const entry = record(value);
  if (typeof entry?.command === 'string' && (entry.type === undefined || entry.type === 'stdio') && entry.url === undefined
    && Array.isArray(entry.args) && entry.args.length === 2 && typeof entry.args[0] === 'string' && basename(entry.args[0]) === designMcpEntry
    && typeof entry.args[1] === 'string' && isAbsolute(entry.args[1]) && record(entry.env)?.ELECTRON_RUN_AS_NODE === '1') return entry.args[1];
}

function clientEntryOwnership(client: DesignMcpClient, config: DesignMcpStdio, action: DesignMcpConfigAction) {
  let endpointToClaim: string | undefined;
  function conflict(endpoint?: string) {
    const name = client === 'codex' ? 'Codex' : 'Claude Code';
    return new Error(`${name} already has a setsuna-design MCP server.${endpoint ? ` Endpoint: ${endpoint}` : ''}`);
  }
  return {
    canEdit(previous: unknown) {
      if (previous === undefined) return action !== 'disable';
      const endpoint = designMcpEndpoint(previous);
      if (endpoint === config.args[1]) return true;
      if (action === 'disable') return false;
      // Profiles share the managed directory and client filenames, including after the application moves.
      if (action === 'enable' && endpoint && basename(endpoint) === client + '.json'
        && basename(dirname(endpoint)) === basename(dirname(config.args[1]))) {
        endpointToClaim = endpoint;
        return true;
      }
      throw conflict(endpoint);
    },
    async verifyClaim() {
      if (!endpointToClaim) return;
      try {
        await lstat(endpointToClaim);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      throw conflict(endpointToClaim);
    },
  };
}

function editClaudeConfig(source: string, config: DesignMcpStdio, enabled: boolean, canEdit: (previous: unknown) => boolean): string {
  let value: unknown;
  try {
    value = source ? JSON.parse(source.replace(/^\uFEFF/u, '')) : {};
  } catch {
    throw new Error('Claude Code user configuration is invalid JSON.');
  }
  const root = record(value);
  const servers = root?.mcpServers === undefined ? {} : record(root.mcpServers);
  if (!root || !servers) throw new Error('Claude Code user configuration has an invalid MCP servers object.');
  const existing = servers[designMcpName];
  if (!canEdit(existing)) return source;
  if (enabled) {
    const previous = record(existing);
    const entry = { ...previous, type: 'stdio', ...config, env: { ...record(previous?.env), ...config.env } };
    if (JSON.stringify(entry) === JSON.stringify(previous)) return source;
    servers[designMcpName] = entry;
    root.mcpServers = servers;
  } else {
    delete servers[designMcpName];
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export async function updateDesignMcpClient(file: string, client: DesignMcpClient, config: DesignMcpStdio, action: DesignMcpConfigAction, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const edit = client === 'codex' ? (await import('./codex-config.js')).editCodexConfig : editClaudeConfig;
  let target = file;
  let mode = 0o600;
  try {
    // Update the destination of a dotfile symlink, preserving the link itself.
    const entry = await lstat(file);
    if (entry.isSymbolicLink()) target = await realpath(file);
    mode = entry.isSymbolicLink() ? (await lstat(target)).mode & 0o777 : entry.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if ((await lstat(file).catch(() => null))?.isSymbolicLink()) throw error;
  }
  const read = () => readFile(target, { encoding: 'utf8', signal }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return '';
  });
  const before = await read();
  const ownership = clientEntryOwnership(client, config, action);
  const after = edit(before, config, action !== 'disable', ownership.canEdit);
  if (after === before) return;
  await ownership.verifyClaim();
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, after, { mode, flag: 'wx', signal });
    // A client edit or another instance restoring its endpoint invalidates the staged replacement.
    if (await read() !== before) throw new Error('MCP client configuration changed. Try again.');
    await ownership.verifyClaim();
    signal.throwIfAborted();
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
