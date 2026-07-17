import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  RuntimeHookEventName,
  RuntimeHookInput,
  RuntimeHooksConfig,
  RuntimeMcpServerInput,
  RuntimePluginFilePreview,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginInstallInput,
  RuntimePluginInstallResult,
  RuntimePluginHook,
  RuntimePluginList,
  RuntimePluginMcpServerDescriptor,
  RuntimePluginRemoveResult,
  RuntimePluginResource,
  RuntimePluginSkill,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { McpClientRuntime } from '../../ports/mcp-client-runtime.js';
import type { McpStore } from '../../ports/mcp-store.js';
import type {
  InstalledPluginRecord,
  PluginBundleInspection,
  PluginBundleStore,
  PluginResourceRead,
} from '../../ports/plugin-bundle-store.js';
import type { SkillRegistry } from '../../ports/skill-registry.js';
import { detectSafeImageMimeType } from '../../utils/safe-image.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';

type PluginIndexFile = { version: 1; plugins: InstalledPluginRecord[] };

type ParsedPluginManifest = {
  id: string;
  name: string;
  icon?: string;
  version?: string;
  description?: string;
  publisher?: string;
  tags: string[];
  featured: boolean;
  sourcePath: string;
  manifestPath: string;
  skillEntries: Array<{ id: string; name: string; description?: string; relativePath: string }>;
  mcpServers: RuntimeMcpServerInput[];
  hooks: ParsedPluginHook[];
  resources: RuntimePluginResource[];
};

type ParsedPluginHook = RuntimeHookInput & Pick<RuntimePluginHook, 'id' | 'name' | 'description'>;

const PLUGIN_MANIFEST_RELATIVE_PATH = path.join('.setsuna-plugin', 'plugin.json');
const MAX_PLUGIN_MANIFEST_BYTES = 256 * 1024;
const MAX_PLUGIN_FILES = 1_000;
const MAX_PLUGIN_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_PLUGIN_RESOURCE_BYTES = 8 * 1024 * 1024;
const MAX_PLUGIN_TEXT_RESOURCE_BYTES = 512 * 1024;
const HOOK_EVENTS = new Set<RuntimeHookEventName>([
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

type PluginMcpClient = Pick<McpClientRuntime, 'invalidateServer'>;

/** 安装自包含的本地插件包，并管理其可逆集成。 */
export class FilePluginBundleStore implements PluginBundleStore {
  private readonly indexPath: string;
  private readonly pluginsDir: string;

  constructor(
    dataDir: string,
    private readonly skills: Pick<SkillRegistry, 'listSkills'>,
    private readonly mcpStore: McpStore,
    private readonly mcpClient: PluginMcpClient,
    private readonly configStore: ConfigStore,
    private readonly clock: Clock,
  ) {
    this.indexPath = path.join(dataDir, 'plugins.json');
    this.pluginsDir = path.join(dataDir, 'plugins');
  }

  async listPlugins(): Promise<RuntimePluginList> {
    const index = await this.readIndex();
    return { plugins: index.plugins.map(publicPluginSummary) };
  }

  async listInstalledRecords(): Promise<InstalledPluginRecord[]> {
    return (await this.readIndex()).plugins.map(cloneInstalledRecord);
  }

  async inspectPlugin(input: RuntimePluginInstallInput): Promise<PluginBundleInspection> {
    const sourcePath = await requiredBundleDirectory(input.path);
    const manifest = await readPluginManifest(sourcePath);
    await inspectBundleTree(sourcePath);
    return {
      id: manifest.id,
      name: manifest.name,
      ...(manifest.icon ? { icon: manifest.icon } : {}),
      ...(manifest.version ? { version: manifest.version } : {}),
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.publisher ? { publisher: manifest.publisher } : {}),
      tags: [...manifest.tags],
      featured: manifest.featured,
      capabilities: {
        skills: manifest.skillEntries.length,
        mcpServers: manifest.mcpServers.length,
        hooks: manifest.hooks.length,
        resources: manifest.resources.length,
      },
      skills: manifest.skillEntries.map(({ id, name, description }) => ({
        id,
        name,
        ...(description ? { description } : {}),
      })),
      mcpServers: manifest.mcpServers.map(pluginMcpServerDescriptor),
      hooks: manifest.hooks.map(pluginHookDescriptor),
      resources: manifest.resources.map((resource) => ({ ...resource })),
      sourcePath,
    };
  }

  async installPlugin(input: RuntimePluginInstallInput): Promise<RuntimePluginInstallResult> {
    return withFileStateUpdate(this.indexPath, async () => {
      const sourcePath = await requiredBundleDirectory(input.path);
      if (pathsOverlap(sourcePath, this.pluginsDir)) {
        throw new Error('Plugin source and runtime plugin directory cannot contain one another.');
      }
      const manifest = await readPluginManifest(sourcePath);
      await inspectBundleTree(sourcePath);
      const index = await this.readIndex();
      if (index.plugins.some((plugin) => plugin.id === manifest.id)) {
        throw new Error(`Plugin is already installed: ${manifest.id}`);
      }
      const existingSkillIds = new Set((await this.skills.listSkills()).skills.map((skill) => skill.id));
      const conflictingSkill = manifest.skillEntries.find((skill) => existingSkillIds.has(skill.id));
      if (conflictingSkill) throw new Error(`Plugin skill id conflicts with an existing skill: ${conflictingSkill.id}`);

      const installPath = path.join(this.pluginsDir, manifest.id);
      const installedManifestPath = path.join(installPath, PLUGIN_MANIFEST_RELATIVE_PATH);
      const mcpInputs = manifest.mcpServers.map((server) => materializePluginMcpServer(server, installPath));
      const existingServers = await this.mcpStore.listServerInputs();
      const mcpOwnership = mcpInputs.map((server) => {
        const existing = existingServers.find((candidate) => candidate.key === server.key);
        if (existing && !compatibleMcpServer(existing, server)) {
          throw new Error(`Plugin MCP server conflicts with existing key: ${server.key}`);
        }
        return { key: server.key, owned: !existing };
      });
      const hooks = manifest.hooks.map((hook) => materializePluginHook(hook, manifest.id, installPath, installedManifestPath));
      const configBefore = await this.configStore.getConfig();
      const record: InstalledPluginRecord = {
        id: manifest.id,
        name: manifest.name,
        ...(manifest.icon ? { icon: manifest.icon } : {}),
        ...(manifest.version ? { version: manifest.version } : {}),
        ...(manifest.description ? { description: manifest.description } : {}),
        ...(manifest.publisher ? { publisher: manifest.publisher } : {}),
        ...(manifest.tags.length ? { tags: [...manifest.tags] } : {}),
        sourcePath,
        installPath,
        installedAt: this.clock.now().toISOString(),
        manifestPath: installedManifestPath,
        skills: manifest.skillEntries.map((skill): RuntimePluginSkill => ({
          id: skill.id,
          name: skill.name,
          ...(skill.description ? { description: skill.description } : {}),
        })),
        skillEntries: manifest.skillEntries.map(({ id, relativePath }) => ({ id, relativePath })),
        mcpServers: mcpOwnership.map((ownership) => {
          const server = mcpInputs.find((candidate) => candidate.key === ownership.key)!;
          return { ...pluginMcpServerDescriptor(server), owned: ownership.owned };
        }),
        mcpServerInputs: mcpInputs,
        hooks: manifest.hooks.map(pluginHookDescriptor),
        hookCount: hooks.length,
        resources: manifest.resources.map((resource) => ({ ...resource })),
      };

      const stagingPath = path.join(this.pluginsDir, `.${manifest.id}.${randomUUID()}.tmp`);
      const installedMcpServers: string[] = [];
      let hooksSaved = false;
      try {
        await mkdir(this.pluginsDir, { recursive: true });
        await copyBundleTree(sourcePath, stagingPath);
        await rename(stagingPath, installPath);
        for (const ownership of mcpOwnership) {
          if (!ownership.owned) continue;
          const server = mcpInputs.find((candidate) => candidate.key === ownership.key);
          if (!server) continue;
          await this.mcpStore.upsertServer(server);
          installedMcpServers.push(server.key);
        }
        if (hooks.length) {
          await this.configStore.saveConfig({ hooks: addPluginHooks(configBefore.hooks ?? {}, hooks) });
          hooksSaved = true;
        }
        await writeJsonFile(this.indexPath, { version: 1, plugins: [...index.plugins, record] } satisfies PluginIndexFile);
      } catch (error) {
        if (hooksSaved) await this.configStore.saveConfig({ hooks: configBefore.hooks ?? {} }).catch(() => undefined);
        await Promise.allSettled(installedMcpServers.map((key) => this.mcpStore.deleteServer(key)));
        await Promise.allSettled([rm(stagingPath, { force: true, recursive: true }), rm(installPath, { force: true, recursive: true })]);
        throw error;
      }
      await Promise.allSettled(mcpOwnership.map(({ key }) => this.mcpClient.invalidateServer(key)));
      return {
        plugin: publicPluginSummary(record),
        installedMcpServers,
        reusedMcpServers: mcpOwnership.filter((item) => !item.owned).map((item) => item.key),
      };
    });
  }

  async removePlugin(pluginId: string): Promise<RuntimePluginRemoveResult> {
    return withFileStateUpdate(this.indexPath, async () => {
      const id = normalizePluginId(pluginId);
      const index = await this.readIndex();
      const plugin = index.plugins.find((item) => item.id === id);
      if (!plugin) throw new Error(`Plugin not found: ${id}`);
      const currentServers = await this.mcpStore.listServerInputs();
      const preservedMcpServers: string[] = [];
      const serversToRemove: RuntimeMcpServerInput[] = [];
      for (const ownership of plugin.mcpServers) {
        if (!ownership.owned) continue;
        const expected = plugin.mcpServerInputs.find((server) => server.key === ownership.key);
        const current = currentServers.find((server) => server.key === ownership.key);
        if (!current) continue;
        if (!expected || !compatibleMcpServer(current, expected)) {
          preservedMcpServers.push(ownership.key);
          continue;
        }
        serversToRemove.push(current);
      }
      const configBefore = await this.configStore.getConfig();
      const removalPath = path.join(this.pluginsDir, `.${plugin.id}.${randomUUID()}.remove`);
      const installExists = await stat(plugin.installPath).then(() => true).catch(() => false);
      if (installExists) await rename(plugin.installPath, removalPath);
      const removedMcpServers: string[] = [];
      try {
        for (const server of serversToRemove) {
          await this.mcpStore.deleteServer(server.key);
          removedMcpServers.push(server.key);
        }
        if (plugin.hookCount) {
          await this.configStore.saveConfig({
            hooks: removePluginHooks(configBefore.hooks ?? {}, plugin.id, plugin.manifestPath),
          });
        }
        await writeJsonFile(this.indexPath, {
          version: 1,
          plugins: index.plugins.filter((item) => item.id !== plugin.id),
        } satisfies PluginIndexFile);
      } catch (error) {
        if (plugin.hookCount) {
          await this.configStore.saveConfig({ hooks: configBefore.hooks ?? {} }).catch(() => undefined);
        }
        await Promise.allSettled(
          serversToRemove
            .filter((server) => removedMcpServers.includes(server.key))
            .map((server) => this.mcpStore.upsertServer(server)),
        );
        if (installExists) await rename(removalPath, plugin.installPath).catch(() => undefined);
        await Promise.allSettled(plugin.mcpServers.map(({ key }) => this.mcpClient.invalidateServer(key)));
        throw error;
      }
      if (installExists) await rm(removalPath, { recursive: true, force: true }).catch(() => undefined);
      await Promise.allSettled(plugin.mcpServers.map(({ key }) => this.mcpClient.invalidateServer(key)));
      return { pluginId: plugin.id, removedMcpServers, preservedMcpServers };
    });
  }

  async readResource(pluginId: string, resourceId: string): Promise<PluginResourceRead> {
    const plugin = (await this.readIndex()).plugins.find((item) => item.id === normalizePluginId(pluginId));
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
    const resource = plugin.resources.find((item) => item.id === normalizeResourceId(resourceId));
    if (!resource) throw new Error(`Plugin resource not found: ${plugin.id}/${resourceId}`);
    const file = await readPluginFilePreview(plugin.installPath, resource.path);
    return {
      pluginId: plugin.id,
      resourceId: resource.id,
      label: resource.label,
      ...file,
    };
  }

  async readItemContent(
    pluginId: string,
    kind: RuntimePluginItemKind,
    itemId: string,
  ): Promise<RuntimePluginItemContent> {
    const plugin = (await this.readIndex()).plugins.find((item) => item.id === normalizePluginId(pluginId));
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
    const manifest = await readPluginManifest(await realpath(plugin.installPath));
    if (manifest.id !== plugin.id) throw new Error('Installed plugin manifest id does not match its index.');
    return readManifestItemContent(manifest, kind, itemId);
  }

  async readBundleItemContent(
    input: RuntimePluginInstallInput,
    kind: RuntimePluginItemKind,
    itemId: string,
  ): Promise<RuntimePluginItemContent> {
    const sourcePath = await requiredBundleDirectory(input.path);
    const manifest = await readPluginManifest(sourcePath);
    await inspectBundleTree(sourcePath);
    return readManifestItemContent(manifest, kind, itemId);
  }

  private async readIndex(): Promise<PluginIndexFile> {
    const index = await readJsonFile<PluginIndexFile>(this.indexPath, { version: 1, plugins: [] });
    return { version: 1, plugins: Array.isArray(index.plugins) ? index.plugins : [] };
  }
}

async function readManifestItemContent(
  manifest: ParsedPluginManifest,
  kind: RuntimePluginItemKind,
  itemId: string,
): Promise<RuntimePluginItemContent> {
  const files = await Promise.all(
    pluginItemFilePaths(manifest, kind, itemId).map((filePath) => readPluginFilePreview(manifest.sourcePath, filePath, true)),
  );
  return { pluginId: manifest.id, itemId, kind, files };
}

function pluginItemFilePaths(
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

function pluginRootFileReferences(values: Array<string | undefined>): string[] {
  const references = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(/\{\{pluginRoot\}\}[\\/]+([^\s'"`]+)/gu)) {
      references.add(safeRelativePath(match[1].replace(/[\\/]+/gu, path.sep), 'Plugin item file path'));
    }
  }
  return [...references];
}

async function readPluginFilePreview(
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

async function readPluginManifest(sourcePath: string): Promise<ParsedPluginManifest> {
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

async function normalizePluginSkills(
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

async function normalizePluginResources(sourcePath: string, value: unknown): Promise<RuntimePluginResource[]> {
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

function normalizePluginMcpServers(value: unknown): RuntimeMcpServerInput[] {
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

function pluginMcpServerDescriptor(server: RuntimeMcpServerInput): RuntimePluginMcpServerDescriptor {
  return {
    key: server.key,
    label: server.label ?? server.key,
    ...(server.description ? { description: server.description } : {}),
    transport: normalizeMcpTransport(server.transport, server.command, server.url),
  };
}

function normalizePluginHooks(value: unknown): ParsedPluginHook[] {
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

function pluginHookDescriptor(hook: ParsedPluginHook): RuntimePluginHook {
  return {
    id: hook.id,
    name: hook.name,
    ...(hook.description ? { description: hook.description } : {}),
    eventName: hook.eventName,
    ...(hook.matcher ? { matcher: hook.matcher } : {}),
    ...(hook.statusMessage ? { statusMessage: hook.statusMessage } : {}),
  };
}

function materializePluginMcpServer(server: RuntimeMcpServerInput, installPath: string): RuntimeMcpServerInput {
  return removeUndefined({
    ...server,
    command: replacePluginRoot(server.command, installPath, false),
    cwd: replacePluginRoot(server.cwd, installPath, false),
    args: server.args?.map((arg) => replacePluginRoot(arg, installPath, false) ?? arg),
  });
}

function materializePluginHook(
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

function addPluginHooks(
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

function removePluginHooks(existing: RuntimeHooksConfig, pluginId: string, manifestPath: string): RuntimeHooksConfig {
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

function cloneHooks(hooks: RuntimeHooksConfig): RuntimeHooksConfig {
  return {
    ...Object.fromEntries([...HOOK_EVENTS].flatMap((eventName) => {
      const groups = hooks[eventName];
      return groups ? [[eventName, groups.map((group) => ({ ...group, hooks: group.hooks.map((handler) => ({ ...handler })) }))]] : [];
    })),
    ...(hooks.state ? { state: Object.fromEntries(Object.entries(hooks.state).map(([key, value]) => [key, { ...value }])) } : {}),
  };
}

async function inspectBundleTree(root: string): Promise<void> {
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

async function copyBundleTree(sourceRoot: string, destinationRoot: string): Promise<void> {
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

async function requiredBundleDirectory(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Plugin bundle path is required.');
  if (!path.isAbsolute(value.trim())) throw new Error('Plugin bundle path must be absolute.');
  const resolved = await realpath(path.resolve(value.trim()));
  if (!(await stat(resolved)).isDirectory()) throw new Error('Plugin bundle path must be a directory.');
  return resolved;
}

async function safeExistingPath(root: string, relativePath: string): Promise<string> {
  const target = await realpath(path.resolve(root, relativePath));
  if (!pathIsInside(root, target)) throw new Error(`Plugin path escapes the bundle: ${relativePath}`);
  return target;
}

function safeRelativePath(value: string, label: string): string {
  if (!value || path.isAbsolute(value)) throw new Error(`${label} must be relative.`);
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error(`${label} escapes the bundle.`);
  return normalized;
}

function pathsOverlap(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return pathIsInside(resolvedLeft, resolvedRight) || pathIsInside(resolvedRight, resolvedLeft);
}

function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function compatibleMcpServer(left: RuntimeMcpServerInput, right: RuntimeMcpServerInput): boolean {
  const leftTransport = normalizeMcpTransport(left.transport, left.command, left.url);
  const rightTransport = normalizeMcpTransport(right.transport, right.command, right.url);
  if (leftTransport !== rightTransport) return false;
  if (leftTransport === 'streamableHttp') return comparableUrl(left.url) === comparableUrl(right.url);
  return left.command?.trim() === right.command?.trim()
    && arraysEqual(left.args ?? [], right.args ?? [])
    && normalizeOptionalPath(left.cwd) === normalizeOptionalPath(right.cwd);
}

function comparableUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return value.trim().replace(/\/$/u, '');
  }
}

function normalizeOptionalPath(value: string | undefined): string {
  return value ? path.normalize(value) : '';
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function normalizeMcpTransport(transport: unknown, command: unknown, url: unknown): 'stdio' | 'streamableHttp' {
  if (transport === 'stdio') return 'stdio';
  if (transport === 'streamableHttp' || transport === 'streamable_http' || transport === 'streamable-http' || transport === 'http') {
    return 'streamableHttp';
  }
  if (typeof command === 'string' && command.trim()) return 'stdio';
  if (typeof url === 'string' && url.trim()) return 'streamableHttp';
  throw new Error('Plugin MCP server requires transport stdio or streamable_http.');
}

function safeHttpUrl(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Plugin MCP URL must use HTTPS or loopback HTTP.');
  }
  if (url.username || url.password) throw new Error('Plugin MCP URL cannot contain credentials.');
  return url.toString();
}

function replacePluginRoot(value: string | undefined, installPath: string, shellQuote: boolean): string | undefined {
  if (!value) return undefined;
  if (!shellQuote) return value.replaceAll('{{pluginRoot}}', installPath);
  return value.replace(/\{\{pluginRoot\}\}([^\s'"`]*)/gu, (_match, suffix: string) =>
    shellQuotedPath(`${installPath}${suffix}`));
}

function shellQuotedPath(value: string): string {
  return process.platform === 'win32'
    ? `"${value.replaceAll('"', '""')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function publicPluginSummary(plugin: InstalledPluginRecord): RuntimePluginSummary {
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

function cloneInstalledRecord(plugin: InstalledPluginRecord): InstalledPluginRecord {
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

function normalizePluginId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
  if (!id) throw new Error('Plugin id is required.');
  return id;
}

function normalizeSkillId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
  if (!id) throw new Error('Plugin skill directory requires a valid id.');
  return id;
}

function normalizeMcpKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '');
  if (!key) throw new Error('Plugin MCP key is required.');
  return key;
}

function normalizeResourceId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 100);
  if (!id) throw new Error('Plugin resource id is required.');
  return id;
}

function normalizeHookId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 100);
  if (!id) throw new Error('Plugin Hook requires a valid id.');
  return id;
}

function skillMetadata(content: string, fallback: string): { name: string; description?: string } {
  if (!content.startsWith('---\n')) return { name: fallback };
  const end = content.indexOf('\n---', 4);
  if (end < 0) return { name: fallback };
  const lines = content.slice(4, end).split('\n');
  const name = frontmatterText(lines, 'name') || fallback;
  const description = frontmatterText(lines, 'description');
  return { name, ...(description ? { description } : {}) };
}

function frontmatterText(lines: string[], key: string): string | undefined {
  const prefix = `${key}:`;
  const line = lines.find((item) => item.startsWith(prefix));
  return line?.slice(prefix.length).trim().replace(/^['"]|['"]$/gu, '') || undefined;
}

function textMimeType(filePath: string): string {
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

function binaryMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.pdf': return 'application/pdf';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.zip': return 'application/zip';
    default: return 'application/octet-stream';
  }
}

function optionalTextFields(record: Record<string, unknown>): { version?: string; description?: string } {
  const version = optionalString(record.version);
  const description = optionalString(record.description);
  return { ...(version ? { version } : {}), ...(description ? { description } : {}) };
}

function optionalMarketplaceFields(record: Record<string, unknown>): {
  icon?: string;
  publisher?: string;
  tags: string[];
  featured: boolean;
} {
  const icon = normalizePluginIcon(record.icon);
  const publisher = optionalString(record.publisher);
  return {
    ...(icon ? { icon } : {}),
    ...(publisher ? { publisher } : {}),
    tags: stringArray(record.tags, 'Plugin tags'),
    featured: record.featured === true,
  };
}

function normalizePluginIcon(value: unknown): string | undefined {
  const icon = optionalString(value);
  if (!icon) return undefined;
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(icon)) {
    throw new Error('Plugin icon must be a lowercase renderer icon token.');
  }
  return icon;
}

function objectRecord(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('Plugin timeout values must be positive numbers.');
  return Math.floor(value);
}

function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array.`);
  return value.map((item) => item.trim()).filter(Boolean);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
