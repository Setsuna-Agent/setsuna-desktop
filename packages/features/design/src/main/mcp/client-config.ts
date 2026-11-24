import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { designMcpName, type DesignMcpClient } from '../../contracts/design-mcp.js';

export { designMcpName };
export const designMcpEntry = 'design-mcp.cjs';
export type DesignMcpStdio = Readonly<{ command: string; args: [string, string]; env: { ELECTRON_RUN_AS_NODE: '1' } }>;

export function designMcpClientFiles(home: string, env: NodeJS.ProcessEnv): Record<DesignMcpClient, string> {
  return {
    codex: join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'),
    'claude-code': join(env.CLAUDE_CONFIG_DIR || home, '.claude.json'),
  };
}

export function ownsDesignMcpEntry(value: unknown, config: DesignMcpStdio): boolean {
  const entry = record(value);
  return typeof entry?.command === 'string' && Array.isArray(entry.args) && entry.args.length === 2
    && typeof entry.args[0] === 'string' && basename(entry.args[0]) === designMcpEntry
    && entry.args[1] === config.args[1] && record(entry.env)?.ELECTRON_RUN_AS_NODE === '1';
}

function editClaudeConfig(source: string, config: DesignMcpStdio, enabled: boolean): string {
  let value: unknown;
  try {
    value = source ? JSON.parse(source.replace(/^\uFEFF/u, '')) : {};
  } catch {
    throw new Error('Claude Code user configuration is invalid JSON.');
  }
  const root = record(value);
  const servers = root?.mcpServers === undefined ? {} : record(root.mcpServers);
  if (!root || !servers) throw new Error('Claude Code user configuration has an invalid MCP servers object.');
  if (Object.hasOwn(servers, designMcpName) && !ownsDesignMcpEntry(servers[designMcpName], config)) {
    if (enabled) throw new Error('Claude Code already has a setsuna-design MCP server.');
    return source;
  }
  if (enabled) {
    const previous = record(servers[designMcpName]);
    const entry = { ...previous, type: 'stdio', ...config, env: { ...record(previous?.env), ...config.env } };
    if (JSON.stringify(entry) === JSON.stringify(previous)) return source;
    servers[designMcpName] = entry;
    root.mcpServers = servers;
  } else {
    if (!Object.hasOwn(servers, designMcpName)) return source;
    delete servers[designMcpName];
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export async function updateDesignMcpClient(file: string, client: DesignMcpClient, config: DesignMcpStdio, enabled: boolean, signal: AbortSignal): Promise<void> {
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
  const after = edit(before, config, enabled);
  if (after === before) return;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, after, { mode, flag: 'wx', signal });
    // Refuse to overwrite a client update made while preparing the replacement.
    if (await read() !== before) throw new Error('MCP client configuration changed. Try again.');
    signal.throwIfAborted();
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
