import type {
  RuntimeConfigState,
  RuntimeHookEventName,
  RuntimeHookInput,
  RuntimeHooksConfig,
  RuntimeMcpServerInput,
  RuntimePluginFilePreview,
  RuntimePluginHook,
  RuntimePluginItemKind,
  RuntimePluginMcpServerDescriptor,
  RuntimePluginResource,
  RuntimePluginSummary
} from '@setsuna-desktop/contracts';
import { chmod, copyFile, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { discoverRuntimeHooks } from '../../hooks/runtime-hooks.js';
import type { McpClientRuntime } from '../../ports/mcp-client-runtime.js';
import type {
  InstalledPluginRecord
} from '../../ports/plugin-bundle-store.js';
import { detectSafeImageMimeType } from '../../utils/safe-image.js';

export type PluginIndexFile = { version: 1; plugins: InstalledPluginRecord[] };

export type ParsedPluginManifest = {
  id: string;
  name: string;
  icon?: string;
  version?: string;
  description?: string;
  publisher?: string;
  tags: string[];
  featured: boolean;
  featuredOrder?: number;
  sourcePath: string;
  manifestPath: string;
  skillEntries: Array<{ id: string; name: string; description?: string; relativePath: string }>;
  mcpServers: RuntimeMcpServerInput[];
  hooks: ParsedPluginHook[];
  resources: RuntimePluginResource[];
};

export type ParsedPluginHook = RuntimeHookInput & Pick<RuntimePluginHook, 'id' | 'name' | 'description'>;

export const PLUGIN_MANIFEST_RELATIVE_PATH = path.join('.setsuna-plugin', 'plugin.json');
export const MAX_PLUGIN_MANIFEST_BYTES = 256 * 1024;
export const MAX_PLUGIN_FILES = 1_000;
export const MAX_PLUGIN_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_PLUGIN_RESOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_PLUGIN_TEXT_RESOURCE_BYTES = 512 * 1024;
export const HOOK_EVENTS = new Set<RuntimeHookEventName>([
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
]);

export type PluginMcpClient = Pick<McpClientRuntime, 'invalidateServer'>;

export type PluginMcpUpdateAction =
  | { type: 'upsert'; server: RuntimeMcpServerInput }
  | { type: 'replace'; server: RuntimeMcpServerInput }
  | { type: 'delete'; key: string };

/** 安装自包含的本地插件包，并管理其可逆集成。 */

export function pluginItemFilePaths(
  manifest: ParsedPluginManifest,
  kind: RuntimePluginItemKind,
  itemId: string,
): string[] {
  if (kind === 'skill') {
    const skill = manifest.skillEntries.find((item) => item.id === itemId);
    if (!skill) throw new Error(`Plugin Skill not found: ${manifest.id}/${itemId}`);
    return [path.join(skill.relativePath, 'SKILL.md')];
  }
  if (kind === 'mcp') {
    const server = manifest.mcpServers.find((item) => item.key === itemId);
    if (!server) throw new Error(`Plugin MCP server not found: ${manifest.id}/${itemId}`);
    return pluginRootFileReferences([server.command, ...(server.args ?? [])]);
  }
  if (kind === 'hook') {
    const hook = manifest.hooks.find((item) => item.id === itemId);
    if (!hook) throw new Error(`Plugin Hook not found: ${manifest.id}/${itemId}`);
    return pluginRootFileReferences([hook.command, hook.commandWindows]);
  }
  const resource = manifest.resources.find((item) => item.id === itemId);
  if (!resource) throw new Error(`Plugin resource not found: ${manifest.id}/${itemId}`);
  return [resource.path];
}

export function pluginRootFileReferences(values: Array<string | undefined>): string[] {
  const references = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(/\{\{pluginRoot\}\}[\\/]+([^\s'"`]+)/gu)) {
      references.add(safeRelativePath(match[1].replace(/[\\/]+/gu, path.sep), 'Plugin item file path'));
    }
  }
  return [...references];
}

export async function readPluginFilePreview(
  pluginRootInput: string,
  relativePath: string,
  allowUnsupported = false,
): Promise<RuntimePluginFilePreview> {
  const pluginRoot = await realpath(pluginRootInput);
  const filePath = await realpath(path.resolve(pluginRoot, relativePath));
  if (!pathIsInside(pluginRoot, filePath)) throw new Error('Plugin item path escapes the bundle.');
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error('Plugin item path is not a file.');
  if (fileStat.size > MAX_PLUGIN_RESOURCE_BYTES) {
    throw new Error(`Plugin preview file must not exceed ${MAX_PLUGIN_RESOURCE_BYTES} bytes.`);
  }
  const buffer = await readFile(filePath);
  const imageMimeType = detectSafeImageMimeType(buffer);
  if (imageMimeType) {
    return {
      path: relativePath,
      size: buffer.byteLength,
      mimeType: imageMimeType,
      base64: buffer.toString('base64'),
    };
  }
  if (buffer.byteLength > MAX_PLUGIN_TEXT_RESOURCE_BYTES || buffer.includes(0)) {
    if (allowUnsupported) {
      return {
        path: relativePath,
        size: buffer.byteLength,
        mimeType: binaryMimeType(relativePath),
      };
    }
    throw new Error('Plugin item is not a supported image or bounded UTF-8 text file.');
  }
  return {
    path: relativePath,
    size: buffer.byteLength,
    mimeType: textMimeType(relativePath),
    text: buffer.toString('utf8'),
  };
}

export async function readPluginManifest(sourcePath: string): Promise<ParsedPluginManifest> {
  const manifestPath = path.join(sourcePath, PLUGIN_MANIFEST_RELATIVE_PATH);
  const manifestStat = await stat(manifestPath).catch(() => null);
  if (!manifestStat?.isFile()) throw new Error(`Plugin manifest not found: ${PLUGIN_MANIFEST_RELATIVE_PATH}`);
  if (manifestStat.size > MAX_PLUGIN_MANIFEST_BYTES) throw new Error('Plugin manifest is too large.');
  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  const record = objectRecord(raw, 'Plugin manifest must be a JSON object.');
  if (record.schemaVersion !== 1 && record.schema_version !== 1) throw new Error('Plugin schemaVersion must be 1.');
  const id = normalizePluginId(requiredString(record.id, 'Plugin id'));
  const name = requiredString(record.name, 'Plugin name');
  const skills = await normalizePluginSkills(sourcePath, id, record.skills);
  const resources = await normalizePluginResources(sourcePath, record.resources);
  return {
    id,
    name,
    ...optionalTextFields(record),
    ...optionalMarketplaceFields(record),
    sourcePath,
    manifestPath,
    skillEntries: skills,
    mcpServers: normalizePluginMcpServers(record.mcpServers ?? record.mcp_servers),
    hooks: normalizePluginHooks(record.hooks),
    resources,
  };
}

export async function normalizePluginSkills(
  sourcePath: string,
  pluginId: string,
  value: unknown,
): Promise<ParsedPluginManifest['skillEntries']> {
  let paths: string[];
  if (value === undefined) {
    const skillsDir = path.join(sourcePath, 'skills');
    const entries = await readdir(skillsDir, { withFileTypes: true }).catch(() => []);
    paths = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => path.join('skills', entry.name));
  } else {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('Plugin skills must be an array of relative directory paths.');
    paths = value.map((item) => item.trim()).filter(Boolean);
  }
  const seen = new Set<string>();
  return Promise.all(paths.map(async (relativePath) => {
    const normalizedPath = safeRelativePath(relativePath, 'Plugin skill path');
    const skillPath = await safeExistingPath(sourcePath, path.join(normalizedPath, 'SKILL.md'));
    if (!(await stat(skillPath)).isFile()) throw new Error(`Plugin skill is missing SKILL.md: ${normalizedPath}`);
    const localId = normalizeSkillId(path.basename(normalizedPath));
    const id = `${pluginId}.${localId}`;
    if (seen.has(id)) throw new Error(`Duplicate plugin skill id: ${id}`);
    seen.add(id);
    const metadata = skillMetadata(await readFile(skillPath, 'utf8'), localId);
    return { id, ...metadata, relativePath: normalizedPath };
  }));
}

export async function normalizePluginResources(sourcePath: string, value: unknown): Promise<RuntimePluginResource[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Plugin resources must be an array.');
  const seen = new Set<string>();
  return Promise.all(value.map(async (item, index) => {
    const record = objectRecord(item, `Plugin resources[${index}] must be an object.`);
    const id = normalizeResourceId(requiredString(record.id, `Plugin resources[${index}].id`));
    if (seen.has(id)) throw new Error(`Duplicate plugin resource id: ${id}`);
    seen.add(id);
    const relativePath = safeRelativePath(requiredString(record.path, `Plugin resources[${index}].path`), 'Plugin resource path');
    const filePath = await safeExistingPath(sourcePath, relativePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error(`Plugin resource is not a file: ${relativePath}`);
    if (fileStat.size > MAX_PLUGIN_RESOURCE_BYTES) throw new Error(`Plugin resource exceeds ${MAX_PLUGIN_RESOURCE_BYTES} bytes: ${relativePath}`);
    return {
      id,
      label: optionalString(record.label) ?? id,
      path: relativePath,
      size: fileStat.size,
    };
  }));
}

export function normalizePluginMcpServers(value: unknown): RuntimeMcpServerInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Plugin mcpServers must be an array.');
  const seen = new Set<string>();
  return value.map((item, index) => {
    const record = objectRecord(item, `Plugin mcpServers[${index}] must be an object.`);
    if (record.env !== undefined || record.headers !== undefined || record.envHttpHeaders !== undefined
      || record.env_http_headers !== undefined || record.bearerTokenEnvVar !== undefined || record.bearer_token_env_var !== undefined) {
      throw new Error(`Plugin mcpServers[${index}] cannot embed credentials or environment values.`);
    }
    const key = normalizeMcpKey(requiredString(record.key, `Plugin mcpServers[${index}].key`));
    if (seen.has(key)) throw new Error(`Duplicate plugin MCP key: ${key}`);
    seen.add(key);
    const transport = normalizeMcpTransport(record.transport, record.command, record.url);
    const server: RuntimeMcpServerInput = {
      key,
      label: optionalString(record.label),
      description: optionalString(record.description),
      transport,
      args: stringArray(record.args, `Plugin mcpServers[${index}].args`),
      timeoutMs: optionalPositiveInteger(record.timeoutMs ?? record.timeout_ms),
      startupTimeoutMs: optionalPositiveInteger(record.startupTimeoutMs ?? record.startup_timeout_ms),
      toolTimeoutMs: optionalPositiveInteger(record.toolTimeoutMs ?? record.tool_timeout_ms),
      allowedTools: stringArray(record.allowedTools ?? record.allowed_tools, `Plugin mcpServers[${index}].allowedTools`),
      disabledTools: stringArray(record.disabledTools ?? record.disabled_tools, `Plugin mcpServers[${index}].disabledTools`),
      oauthClientId: optionalString(record.oauthClientId ?? record.oauth_client_id),
      oauthResource: optionalString(record.oauthResource ?? record.oauth_resource),
      required: false,
      enabled: true,
      requireApproval: 'always',
      trustLevel: 'untrusted',
    };
    if (transport === 'streamableHttp') {
      server.url = safeHttpUrl(requiredString(record.url, `Plugin mcpServers[${index}].url`));
    } else {
      server.command = requiredString(record.command, `Plugin mcpServers[${index}].command`);
      server.cwd = optionalString(record.cwd);
    }
    return removeUndefined(server);
  });
}

export function pluginMcpServerDescriptor(server: RuntimeMcpServerInput): RuntimePluginMcpServerDescriptor {
  return {
    key: server.key,
    label: server.label ?? server.key,
    ...(server.description ? { description: server.description } : {}),
    transport: normalizeMcpTransport(server.transport, server.command, server.url),
  };
}

export function normalizePluginHooks(value: unknown): ParsedPluginHook[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Plugin hooks must be an array.');
  const seen = new Set<string>();
  return value.map((item, index) => {
    const record = objectRecord(item, `Plugin hooks[${index}] must be an object.`);
    const eventName = requiredString(record.eventName ?? record.event_name, `Plugin hooks[${index}].eventName`) as RuntimeHookEventName;
    if (!HOOK_EVENTS.has(eventName)) throw new Error(`Unsupported plugin hook event: ${eventName}`);
    const statusMessage = optionalString(record.statusMessage ?? record.status_message);
    const id = normalizeHookId(optionalString(record.id) ?? `${eventName}-${index + 1}`);
    if (seen.has(id)) throw new Error(`Duplicate plugin Hook id: ${id}`);
    seen.add(id);
    return removeUndefined({
      id,
      name: optionalString(record.name) ?? statusMessage ?? `${eventName} Hook`,
      description: optionalString(record.description),
      eventName,
      matcher: optionalString(record.matcher),
      command: requiredString(record.command, `Plugin hooks[${index}].command`),
      commandWindows: optionalString(record.commandWindows ?? record.command_windows),
      timeoutSec: optionalPositiveInteger(record.timeoutSec ?? record.timeout_sec),
      statusMessage,
    });
  });
}

export function pluginHookDescriptor(hook: ParsedPluginHook): RuntimePluginHook {
  return {
    id: hook.id,
    name: hook.name,
    ...(hook.description ? { description: hook.description } : {}),
    eventName: hook.eventName,
    ...(hook.matcher ? { matcher: hook.matcher } : {}),
    ...(hook.statusMessage ? { statusMessage: hook.statusMessage } : {}),
  };
}

export function materializePluginMcpServer(server: RuntimeMcpServerInput, installPath: string): RuntimeMcpServerInput {
  return removeUndefined({
    ...server,
    command: replacePluginRoot(server.command, installPath, false),
    cwd: replacePluginRoot(server.cwd, installPath, false),
    args: server.args?.map((arg) => replacePluginRoot(arg, installPath, false) ?? arg),
  });
}

export function materializePluginHook(
  hook: ParsedPluginHook,
  pluginId: string,
  installPath: string,
  manifestPath: string,
): RuntimeHookInput & { pluginId: string; sourcePath: string } {
  return {
    eventName: hook.eventName,
    ...(hook.matcher ? { matcher: hook.matcher } : {}),
    command: replacePluginRoot(hook.command, installPath, true) ?? hook.command,
    ...(hook.commandWindows ? { commandWindows: replacePluginRoot(hook.commandWindows, installPath, true) } : {}),
    ...(hook.timeoutSec ? { timeoutSec: hook.timeoutSec } : {}),
    ...(hook.statusMessage ? { statusMessage: hook.statusMessage } : {}),
    pluginId,
    sourcePath: manifestPath,
  };
}

export function addPluginHooks(
  existing: RuntimeHooksConfig,
  hooks: Array<RuntimeHookInput & { pluginId: string; sourcePath: string }>,
): RuntimeHooksConfig {
  const next = cloneHooks(existing);
  for (const hook of hooks) {
    const groups = next[hook.eventName] ?? [];
    groups.push({
      ...(hook.matcher ? { matcher: hook.matcher } : {}),
      hooks: [{
        type: 'command',
        command: hook.command,
        ...(hook.commandWindows ? { commandWindows: hook.commandWindows } : {}),
        ...(hook.timeoutSec ? { timeoutSec: hook.timeoutSec } : {}),
        ...(hook.statusMessage ? { statusMessage: hook.statusMessage } : {}),
        pluginId: hook.pluginId,
        sourcePath: hook.sourcePath,
      }],
    });
    next[hook.eventName] = groups;
  }
  return next;
}

export function trustPluginHooks(
  config: RuntimeConfigState,
  hooks: RuntimeHooksConfig,
  pluginId: string,
): RuntimeHooksConfig {
  const discovered = discoverRuntimeHooks({ ...config, hooks }).hooks.filter((hook) => hook.pluginId === pluginId);
  if (!discovered.length) return hooks;

  const next = cloneHooks(hooks);
  next.state = { ...(next.state ?? {}) };
  for (const hook of discovered) {
    next.state[hook.key] = {
      ...(next.state[hook.key] ?? {}),
      trustedHash: hook.currentHash,
    };
  }
  return next;
}

export function removePluginHooks(existing: RuntimeHooksConfig, pluginId: string, manifestPath: string): RuntimeHooksConfig {
  const next = cloneHooks(existing);
  for (const eventName of HOOK_EVENTS) {
    const groups = (next[eventName] ?? [])
      .map((group) => ({
        ...group,
        hooks: group.hooks.filter((handler) => handler.pluginId !== pluginId),
      }))
      .filter((group) => group.hooks.length);
    if (groups.length) next[eventName] = groups;
    else delete next[eventName];
  }
  if (next.state) {
    next.state = Object.fromEntries(Object.entries(next.state).filter(([key]) => !key.startsWith(`${path.resolve(manifestPath)}:`)));
    if (!Object.keys(next.state).length) delete next.state;
  }
  return next;
}

export function cloneHooks(hooks: RuntimeHooksConfig): RuntimeHooksConfig {
  return {
    ...Object.fromEntries([...HOOK_EVENTS].flatMap((eventName) => {
      const groups = hooks[eventName];
      return groups ? [[eventName, groups.map((group) => ({ ...group, hooks: group.hooks.map((handler) => ({ ...handler })) }))]] : [];
    })),
    ...(hooks.state ? { state: Object.fromEntries(Object.entries(hooks.state).map(([key, value]) => [key, { ...value }])) } : {}),
  };
}

export async function inspectBundleTree(root: string): Promise<void> {
  let fileCount = 0;
  let totalBytes = 0;
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Plugin bundles cannot contain symbolic links: ${path.relative(root, entryPath)}`);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Plugin bundles can contain only regular files and directories: ${path.relative(root, entryPath)}`);
      const entryStat = await stat(entryPath);
      fileCount += 1;
      totalBytes += entryStat.size;
      if (fileCount > MAX_PLUGIN_FILES) throw new Error(`Plugin bundle exceeds ${MAX_PLUGIN_FILES} files.`);
      if (totalBytes > MAX_PLUGIN_TOTAL_BYTES) throw new Error(`Plugin bundle exceeds ${MAX_PLUGIN_TOTAL_BYTES} bytes.`);
    }
  }
}

export async function copyBundleTree(sourceRoot: string, destinationRoot: string): Promise<void> {
  await mkdir(destinationRoot, { recursive: true });
  const stack: Array<{ source: string; destination: string }> = [{ source: sourceRoot, destination: destinationRoot }];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of await readdir(current.source, { withFileTypes: true })) {
      const source = path.join(current.source, entry.name);
      const destination = path.join(current.destination, entry.name);
      if (entry.isDirectory()) {
        await mkdir(destination, { recursive: true });
        stack.push({ source, destination });
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported plugin bundle entry: ${path.relative(sourceRoot, source)}`);
      await copyFile(source, destination);
      const sourceStat = await stat(source);
      await chmod(destination, sourceStat.mode & 0o777).catch(() => undefined);
    }
  }
}

export async function requiredBundleDirectory(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Plugin bundle path is required.');
  if (!path.isAbsolute(value.trim())) throw new Error('Plugin bundle path must be absolute.');
  const resolved = await realpath(path.resolve(value.trim()));
  if (!(await stat(resolved)).isDirectory()) throw new Error('Plugin bundle path must be a directory.');
  return resolved;
}

export async function safeExistingPath(root: string, relativePath: string): Promise<string> {
  const target = await realpath(path.resolve(root, relativePath));
  if (!pathIsInside(root, target)) throw new Error(`Plugin path escapes the bundle: ${relativePath}`);
  return target;
}

export function safeRelativePath(value: string, label: string): string {
  if (!value || path.isAbsolute(value)) throw new Error(`${label} must be relative.`);
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error(`${label} escapes the bundle.`);
  return normalized;
}

export function pathsOverlap(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return pathIsInside(resolvedLeft, resolvedRight) || pathIsInside(resolvedRight, resolvedLeft);
}

export function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function compatibleMcpServer(left: RuntimeMcpServerInput, right: RuntimeMcpServerInput): boolean {
  const leftTransport = normalizeMcpTransport(left.transport, left.command, left.url);
  const rightTransport = normalizeMcpTransport(right.transport, right.command, right.url);
  if (leftTransport !== rightTransport) return false;
  if (leftTransport === 'streamableHttp') return comparableUrl(left.url) === comparableUrl(right.url);
  return left.command?.trim() === right.command?.trim()
    && arraysEqual(left.args ?? [], right.args ?? [])
    && normalizeOptionalPath(left.cwd) === normalizeOptionalPath(right.cwd);
}

export function pluginMcpServerUnmodified(current: RuntimeMcpServerInput, expected: RuntimeMcpServerInput): boolean {
  return JSON.stringify(comparablePluginMcpServer(current)) === JSON.stringify(comparablePluginMcpServer(expected));
}

export function comparablePluginMcpServer(server: RuntimeMcpServerInput): Record<string, unknown> {
  const transport = normalizeMcpTransport(server.transport, server.command, server.url);
  const timeoutMs = normalizedMcpTimeout(server.timeoutMs, 120_000);
  return {
    key: server.key,
    label: server.label?.trim() || server.key,
    description: server.description?.trim() || null,
    transport,
    command: transport === 'stdio' ? server.command?.trim() || null : null,
    args: transport === 'stdio' ? normalizedStringList(server.args) : [],
    cwd: transport === 'stdio' ? normalizeOptionalPath(server.cwd) || null : null,
    url: transport === 'streamableHttp' ? comparableUrl(server.url) || null : null,
    timeoutMs,
    startupTimeoutMs: normalizedMcpTimeout(server.startupTimeoutMs, timeoutMs),
    toolTimeoutMs: normalizedMcpTimeout(server.toolTimeoutMs, timeoutMs),
    required: server.required === true,
    requireApproval: comparableMcpApproval(server.requireApproval),
    trustLevel: server.trustLevel === 'trusted' ? 'trusted' : 'untrusted',
    enabled: server.enabled !== false,
    allowedTools: normalizedStringSet(server.allowedTools),
    disabledTools: normalizedStringSet(server.disabledTools),
    tools: canonicalValue(server.tools ?? []),
    env: canonicalStringMap(server.env),
    headers: canonicalStringMap(server.headers),
    envHttpHeaders: canonicalStringMap(server.envHttpHeaders),
    bearerTokenEnvVar: server.bearerTokenEnvVar?.trim() || null,
    oauthClientId: server.oauthClientId?.trim() || null,
    oauthResource: server.oauthResource?.trim() || null,
  };
}

export function comparableMcpApproval(value: RuntimeMcpServerInput['requireApproval']): 'auto' | 'prompt' | 'approve' {
  if (value === 'approve' || value === 'never') return 'approve';
  if (value === 'prompt' || value === 'always') return 'prompt';
  return 'auto';
}

export function normalizedMcpTimeout(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), 30 * 60 * 1_000);
}

export function normalizedStringList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

export function normalizedStringSet(values: string[] | undefined): string[] {
  return [...new Set(normalizedStringList(values))].sort((left, right) => left.localeCompare(right));
}

export function canonicalStringMap(value: Record<string, string> | undefined): Record<string, string> | null {
  if (!value) return null;
  const entries = Object.entries(value)
    .map(([key, item]) => [key.trim(), item.trim()] as const)
    .filter(([key, item]) => key && item)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? Object.fromEntries(entries) : null;
}

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

export function comparableUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return value.trim().replace(/\/$/u, '');
  }
}

export function normalizeOptionalPath(value: string | undefined): string {
  return value ? path.normalize(value) : '';
}

export function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function normalizeMcpTransport(transport: unknown, command: unknown, url: unknown): 'stdio' | 'streamableHttp' {
  if (transport === 'stdio') return 'stdio';
  if (transport === 'streamableHttp' || transport === 'streamable_http' || transport === 'streamable-http' || transport === 'http') {
    return 'streamableHttp';
  }
  if (typeof command === 'string' && command.trim()) return 'stdio';
  if (typeof url === 'string' && url.trim()) return 'streamableHttp';
  throw new Error('Plugin MCP server requires transport stdio or streamable_http.');
}

export function safeHttpUrl(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Plugin MCP URL must use HTTPS or loopback HTTP.');
  }
  if (url.username || url.password) throw new Error('Plugin MCP URL cannot contain credentials.');
  return url.toString();
}

export function replacePluginRoot(value: string | undefined, installPath: string, shellQuote: boolean): string | undefined {
  if (!value) return undefined;
  return value.replace(/\{\{pluginRoot\}\}([^\s'"`]*)/gu, (_match, suffix: string) => {
    const pluginPath = pluginRootPath(installPath, suffix);
    return shellQuote ? shellQuotedPath(pluginPath) : pluginPath;
  });
}

export function pluginRootPath(installPath: string, suffix: string): string {
  if (!suffix) return installPath;
  if (!/^[\\/]/u.test(suffix)) return `${installPath}${suffix}`;
  const segments = suffix.replace(/^[\\/]+/u, '').split(/[\\/]+/u).filter(Boolean);
  return path.join(installPath, ...segments);
}

export function shellQuotedPath(value: string): string {
  return process.platform === 'win32'
    ? `"${value.replaceAll('"', '""')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;
}

export function publicPluginSummary(plugin: InstalledPluginRecord): RuntimePluginSummary {
  const {
    installPath: _installPath,
    manifestPath: _manifestPath,
    mcpServerInputs,
    skillEntries: _skillEntries,
    sourcePath: _sourcePath,
    ...summary
  } = plugin;
  return {
    ...summary,
    ...(summary.tags ? { tags: [...summary.tags] } : {}),
    skills: summary.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
    })),
    // 旧版插件索引只存储归属信息；从已保存的 MCP 输入恢复显示元数据。
    mcpServers: summary.mcpServers.map((server) => {
      const input = mcpServerInputs.find((candidate) => candidate.key === server.key);
      const descriptor = input
        ? pluginMcpServerDescriptor(input)
        : {
            key: server.key,
            label: server.label ?? server.key,
            transport: server.transport ?? 'stdio' as const,
          };
      return {
        ...descriptor,
        ...(server.label ? { label: server.label } : {}),
        ...(server.description ? { description: server.description } : {}),
        ...(server.transport ? { transport: server.transport } : {}),
        owned: server.owned,
      };
    }),
    hooks: (summary.hooks ?? []).map((hook) => ({ ...hook })),
    resources: summary.resources.map((resource) => ({ ...resource })),
  };
}

export function cloneInstalledRecord(plugin: InstalledPluginRecord): InstalledPluginRecord {
  return {
    ...plugin,
    ...(plugin.tags ? { tags: [...plugin.tags] } : {}),
    skills: plugin.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
    })),
    skillEntries: plugin.skillEntries.map((skill) => ({ ...skill })),
    mcpServers: plugin.mcpServers.map((server) => ({ ...server })),
    mcpServerInputs: plugin.mcpServerInputs.map((server) => ({ ...server, args: [...(server.args ?? [])] })),
    hooks: (plugin.hooks ?? []).map((hook) => ({ ...hook })),
    resources: plugin.resources.map((resource) => ({ ...resource })),
  };
}

export function normalizePluginId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
  if (!id) throw new Error('Plugin id is required.');
  return id;
}

export function normalizeSkillId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
  if (!id) throw new Error('Plugin skill directory requires a valid id.');
  return id;
}

export function normalizeMcpKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '');
  if (!key) throw new Error('Plugin MCP key is required.');
  return key;
}

export function normalizeResourceId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 100);
  if (!id) throw new Error('Plugin resource id is required.');
  return id;
}

export function normalizeHookId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 100);
  if (!id) throw new Error('Plugin Hook requires a valid id.');
  return id;
}

export function skillMetadata(content: string, fallback: string): { name: string; description?: string } {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)?.[1];
  if (frontmatter === undefined) return { name: fallback };
  const lines = frontmatter.split(/\r?\n/u);
  const name = frontmatterText(lines, 'name') || fallback;
  const description = frontmatterText(lines, 'description');
  return { name, ...(description ? { description } : {}) };
}

export function frontmatterText(lines: string[], key: string): string | undefined {
  const prefix = `${key}:`;
  const line = lines.find((item) => item.startsWith(prefix));
  return line?.slice(prefix.length).trim().replace(/^['"]|['"]$/gu, '') || undefined;
}

export function textMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.json': return 'application/json';
    case '.yaml':
    case '.yml': return 'application/yaml';
    case '.md': return 'text/markdown';
    case '.html': return 'text/html';
    case '.css': return 'text/css';
    case '.js':
    case '.mjs':
    case '.ts': return 'text/javascript';
    default: return 'text/plain';
  }
}

export function binaryMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.pdf': return 'application/pdf';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.zip': return 'application/zip';
    default: return 'application/octet-stream';
  }
}

export function optionalTextFields(record: Record<string, unknown>): { version?: string; description?: string } {
  const version = optionalString(record.version);
  const description = optionalString(record.description);
  return { ...(version ? { version } : {}), ...(description ? { description } : {}) };
}

export function optionalMarketplaceFields(record: Record<string, unknown>): {
  icon?: string;
  publisher?: string;
  tags: string[];
  featured: boolean;
  featuredOrder?: number;
} {
  const icon = normalizePluginIcon(record.icon);
  const publisher = optionalString(record.publisher);
  const featured = record.featured === true;
  const featuredOrder = optionalFeaturedOrder(record.featuredOrder ?? record.featured_order);
  if (!featured && featuredOrder !== undefined) {
    throw new Error('Plugin featuredOrder requires featured: true.');
  }
  return {
    ...(icon ? { icon } : {}),
    ...(publisher ? { publisher } : {}),
    tags: stringArray(record.tags, 'Plugin tags'),
    featured,
    ...(featuredOrder !== undefined ? { featuredOrder } : {}),
  };
}

export function optionalFeaturedOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Plugin featuredOrder must be a positive integer.');
  }
  return value;
}

export function normalizePluginIcon(value: unknown): string | undefined {
  const icon = optionalString(value);
  if (!icon) return undefined;
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(icon)) {
    throw new Error('Plugin icon must be a lowercase renderer icon token.');
  }
  return icon;
}

export function objectRecord(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('Plugin timeout values must be positive numbers.');
  return Math.floor(value);
}

export function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array.`);
  return value.map((item) => item.trim()).filter(Boolean);
}

export function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
