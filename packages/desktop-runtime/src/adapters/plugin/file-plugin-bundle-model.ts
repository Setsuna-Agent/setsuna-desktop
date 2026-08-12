import type {
  RuntimeConfigState,
  RuntimeExtensionCapability,
  RuntimeExtensionManifest,
  RuntimeHookEventName,
  RuntimeHookInput,
  RuntimeHooksConfig,
  RuntimeMcpServerInput,
  RuntimePluginFilePreview,
  RuntimePluginHook,
  RuntimePluginItemKind,
  RuntimePluginResource,
  RuntimePluginSummary,
  RuntimePluginTool,
} from '@setsuna-desktop/contracts';
import { RUNTIME_EXTENSION_API_VERSION } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { discoverRuntimeHooks } from '../../hooks/runtime-hooks.js';
import type { McpClientRuntime } from '../../ports/mcp-client-runtime.js';
import type {
  InstalledPluginExtensionRecord,
  InstalledPluginRecord,
} from '../../ports/plugin-bundle-store.js';
import { detectSafeImageMimeType } from '../../utils/safe-image.js';
import {
  normalizePluginMcpServers,
  pluginMcpServerDescriptor,
  replacePluginRoot,
} from './file-plugin-bundle-mcp.js';
import {
  binaryMimeType,
  normalizeHookId,
  normalizePluginId,
  normalizeResourceId,
  normalizeSkillId,
  objectRecord,
  optionalMarketplaceFields,
  optionalPositiveInteger,
  optionalString,
  optionalTextFields,
  removeUndefined,
  requiredString,
  skillMetadata,
  textMimeType,
} from './file-plugin-bundle-values.js';

export * from './file-plugin-bundle-values.js';
export * from './file-plugin-bundle-mcp.js';

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
  tools: RuntimePluginTool[];
  skillEntries: Array<{ id: string; name: string; description?: string; relativePath: string }>;
  mcpServers: RuntimeMcpServerInput[];
  hooks: ParsedPluginHook[];
  resources: RuntimePluginResource[];
  extension?: RuntimeExtensionManifest & { entry: string };
};

export type ParsedPluginHook = RuntimeHookInput & Pick<RuntimePluginHook, 'id' | 'name' | 'description'>;

export const PLUGIN_MANIFEST_RELATIVE_PATH = path.join('.setsuna-plugin', 'plugin.json');
export const MAX_PLUGIN_MANIFEST_BYTES = 256 * 1024;
export const MAX_PLUGIN_FILES = 1_000;
export const MAX_PLUGIN_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_PLUGIN_RESOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_PLUGIN_TEXT_RESOURCE_BYTES = 512 * 1024;
const EXTENSION_CAPABILITIES = new Set<RuntimeExtensionCapability>([
  'tools',
  'events',
  'ui',
  'state',
  'network',
  'image-generation',
  'vision-recognition',
]);
const MAX_EXTENSION_NETWORK_ORIGINS = 32;
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
  const schemaVersion = record.schemaVersion ?? record.schema_version;
  if (schemaVersion !== 1 && schemaVersion !== 2) throw new Error('Plugin schemaVersion must be 1 or 2.');
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
    tools: normalizePluginTools(record.tools),
    skillEntries: skills,
    mcpServers: normalizePluginMcpServers(record.mcpServers ?? record.mcp_servers),
    hooks: normalizePluginHooks(record.hooks),
    resources,
    ...await normalizePluginExtension(sourcePath, schemaVersion, record.extension),
  };
}

async function normalizePluginExtension(
  sourcePath: string,
  schemaVersion: 1 | 2,
  value: unknown,
): Promise<{ extension?: RuntimeExtensionManifest & { entry: string } }> {
  if (value === undefined) return {};
  if (schemaVersion !== 2) throw new Error('Executable extensions require plugin schemaVersion 2.');
  const record = objectRecord(value, 'Plugin extension must be an object.');
  if (record.apiVersion !== RUNTIME_EXTENSION_API_VERSION) {
    throw new Error(`Plugin extension apiVersion must be ${RUNTIME_EXTENSION_API_VERSION}.`);
  }
  if (record.runtime !== 'node-worker') throw new Error('Plugin extension runtime must be node-worker.');
  const entry = safeRelativePath(requiredString(record.entry, 'Plugin extension entry'), 'Plugin extension entry');
  if (path.extname(entry).toLowerCase() !== '.mjs') throw new Error('Plugin extension entry must be an .mjs file.');
  const entryPath = await safeExistingPath(sourcePath, entry);
  if (!(await stat(entryPath)).isFile()) throw new Error('Plugin extension entry must be a file.');
  if (!Array.isArray(record.capabilities) || !record.capabilities.length) {
    throw new Error('Plugin extension capabilities must be a non-empty array.');
  }
  const capabilities: RuntimeExtensionCapability[] = [];
  for (const [index, capability] of record.capabilities.entries()) {
    if (typeof capability !== 'string' || !EXTENSION_CAPABILITIES.has(capability as RuntimeExtensionCapability)) {
      throw new Error(`Plugin extension capabilities[${index}] is unsupported.`);
    }
    const normalized = capability as RuntimeExtensionCapability;
    if (capabilities.includes(normalized)) throw new Error(`Duplicate plugin extension capability: ${normalized}`);
    capabilities.push(normalized);
  }
  const network = normalizeExtensionNetworkPolicy(record.network, capabilities);
  return {
    extension: {
      apiVersion: RUNTIME_EXTENSION_API_VERSION,
      runtime: 'node-worker',
      capabilities,
      ...(network ? { network } : {}),
      entry,
    },
  };
}

function normalizeExtensionNetworkPolicy(
  value: unknown,
  capabilities: RuntimeExtensionCapability[],
): RuntimeExtensionManifest['network'] | undefined {
  const networkEnabled = capabilities.includes('network');
  if (!networkEnabled) {
    if (value !== undefined) throw new Error('Plugin extension network policy requires the network capability.');
    return undefined;
  }
  const record = objectRecord(value, 'Plugin extension network policy must be an object.');
  if (!Array.isArray(record.allowedOrigins) || !record.allowedOrigins.length) {
    throw new Error('Plugin extension network.allowedOrigins must be a non-empty array.');
  }
  if (record.allowedOrigins.length > MAX_EXTENSION_NETWORK_ORIGINS) {
    throw new Error(`Plugin extension network.allowedOrigins cannot exceed ${MAX_EXTENSION_NETWORK_ORIGINS} entries.`);
  }
  const allowedOrigins: string[] = [];
  for (const [index, origin] of record.allowedOrigins.entries()) {
    const normalized = extensionNetworkOrigin(origin, index);
    if (!allowedOrigins.includes(normalized)) allowedOrigins.push(normalized);
  }
  return { allowedOrigins };
}

function extensionNetworkOrigin(value: unknown, index: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Plugin extension network.allowedOrigins[${index}] must be an HTTP(S) origin.`);
  }
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash) {
      throw new Error('invalid origin');
    }
    return url.origin;
  } catch {
    throw new Error(`Plugin extension network.allowedOrigins[${index}] must be an HTTP(S) origin.`);
  }
}

export function normalizePluginTools(value: unknown): RuntimePluginTool[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Plugin tools must be an array.');
  const seen = new Set<string>();
  return value.map((item, index) => {
    const record = objectRecord(item, `Plugin tools[${index}] must be an object.`);
    const name = requiredString(record.name, `Plugin tools[${index}].name`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(name)) {
      throw new Error(`Plugin tools[${index}].name is invalid.`);
    }
    if (seen.has(name)) throw new Error(`Duplicate plugin tool name: ${name}`);
    seen.add(name);
    const description = optionalString(record.description);
    const exposure = optionalString(record.exposure);
    if (exposure !== undefined && exposure !== 'namespaced' && exposure !== 'direct') {
      throw new Error(`Plugin tools[${index}].exposure must be namespaced or direct.`);
    }
    const supportsParallel = optionalPluginToolBoolean(
      record.supportsParallel ?? record.supports_parallel,
      `Plugin tools[${index}].supportsParallel`,
    );
    const requiresApproval = optionalPluginToolBoolean(
      record.requiresApproval ?? record.requires_approval,
      `Plugin tools[${index}].requiresApproval`,
    );
    const requiresSandboxBypassApproval = optionalPluginToolBoolean(
      record.requiresSandboxBypassApproval ?? record.requires_sandbox_bypass_approval,
      `Plugin tools[${index}].requiresSandboxBypassApproval`,
    );
    return {
      name,
      ...(description ? { description } : {}),
      ...(exposure ? { exposure } : {}),
      ...(supportsParallel !== undefined ? { supportsParallel } : {}),
      ...(requiresApproval !== undefined ? { requiresApproval } : {}),
      ...(requiresSandboxBypassApproval !== undefined ? { requiresSandboxBypassApproval } : {}),
    };
  });
}

function optionalPluginToolBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
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

export function materializePluginHook(
  hook: ParsedPluginHook,
  pluginId: string,
  installPath: string,
  manifestPath: string,
): RuntimeHookInput & { pluginId: string; pluginHookId: string; sourcePath: string } {
  return {
    eventName: hook.eventName,
    ...(hook.matcher ? { matcher: hook.matcher } : {}),
    command: replacePluginRoot(hook.command, installPath, true) ?? hook.command,
    ...(hook.commandWindows ? { commandWindows: replacePluginRoot(hook.commandWindows, installPath, true) } : {}),
    ...(hook.timeoutSec ? { timeoutSec: hook.timeoutSec } : {}),
    ...(hook.statusMessage ? { statusMessage: hook.statusMessage } : {}),
    pluginId,
    pluginHookId: hook.id,
    sourcePath: manifestPath,
  };
}

export function addPluginHooks(
  existing: RuntimeHooksConfig,
  hooks: Array<RuntimeHookInput & { pluginId: string; pluginHookId: string; sourcePath: string }>,
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
        pluginHookId: hook.pluginHookId,
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

export async function inspectBundleTree(root: string): Promise<{ bundleHash: string }> {
  let fileCount = 0;
  let totalBytes = 0;
  const files: Array<{ absolutePath: string; relativePath: string; size: number }> = [];
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
      files.push({
        absolutePath: entryPath,
        relativePath: path.relative(root, entryPath).split(path.sep).join('/'),
        size: entryStat.size,
      });
    }
  }
  files.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
  const hash = createHash('sha256');
  for (const file of files) {
    const relativePathBytes = Buffer.byteLength(file.relativePath);
    hash.update(`${relativePathBytes}:${file.relativePath}:${file.size}:`, 'utf8');
    hash.update(await readFile(file.absolutePath));
  }
  return { bundleHash: hash.digest('hex') };
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
  // macOS commonly exposes /var through a /private/var symlink. Compare real
  // paths on both sides so a valid file is not mistaken for a bundle escape.
  const resolvedRoot = await realpath(root);
  const target = await realpath(path.resolve(resolvedRoot, relativePath));
  if (!pathIsInside(resolvedRoot, target)) throw new Error(`Plugin path escapes the bundle: ${relativePath}`);
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

export function publicPluginSummary(plugin: InstalledPluginRecord): RuntimePluginSummary {
  const {
    installPath: _installPath,
    manifestPath: _manifestPath,
    mcpServerInputs,
    skillEntries: _skillEntries,
    sourcePath: _sourcePath,
    extension,
    ...summary
  } = plugin;
  return {
    ...summary,
    installationSource: plugin.installationSource ?? 'local',
    ...(extension ? { extension: publicPluginExtension(extension) } : {}),
    ...(summary.tools?.length ? { tools: summary.tools.map((tool) => ({ ...tool })) } : {}),
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
    ...(plugin.tools?.length ? { tools: plugin.tools.map((tool) => ({ ...tool })) } : {}),
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
    ...(plugin.extension ? {
      extension: {
        ...plugin.extension,
        capabilities: [...plugin.extension.capabilities],
        ...(plugin.extension.network ? {
          network: { allowedOrigins: [...plugin.extension.network.allowedOrigins] },
        } : {}),
      },
    } : {}),
  };
}

export function publicPluginExtension(extension: InstalledPluginExtensionRecord) {
  const trust = !extension.trustedHash
    ? 'untrusted' as const
    : extension.trustedHash === extension.bundleHash
      ? 'trusted' as const
      : 'modified' as const;
  return {
    apiVersion: extension.apiVersion,
    runtime: extension.runtime,
    capabilities: [...extension.capabilities],
    ...(extension.network ? {
      network: { allowedOrigins: [...extension.network.allowedOrigins] },
    } : {}),
    trust,
  };
}
