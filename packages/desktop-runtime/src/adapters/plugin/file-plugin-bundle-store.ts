import type {
  RuntimeMcpServerInput,
  RuntimePluginInstallInput,
  RuntimePluginInstallResult,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginList,
  RuntimePluginRemoveResult,
  RuntimePluginSkill
} from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { McpStore } from '../../ports/mcp-store.js';
import type {
  InstalledPluginRecord,
  PluginBundleInspection,
  PluginBundleMutationOptions,
  PluginBundleStore,
  PluginResourceRead,
} from '../../ports/plugin-bundle-store.js';
import type { PluginSkillRegistry } from '../../ports/skill-registry.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { readJsonFile, renameWithRetry, writeJsonFile } from '../store/json-file.js';
import type {
  ParsedPluginManifest,
  PluginIndexFile,
  PluginMcpClient,
  PluginMcpUpdateAction
} from './file-plugin-bundle-model.js';
import {
  PLUGIN_MANIFEST_RELATIVE_PATH,
  addPluginHooks,
  cloneInstalledRecord,
  compatibleMcpServer,
  copyBundleTree,
  inspectBundleTree,
  materializePluginHook,
  materializePluginMcpServer,
  normalizePluginId,
  normalizeResourceId,
  pathsOverlap,
  pluginHookDescriptor,
  pluginItemFilePaths,
  pluginMcpServerDescriptor,
  pluginMcpServerUnmodified,
  publicPluginSummary,
  readPluginFilePreview,
  readPluginManifest,
  removePluginHooks,
  requiredBundleDirectory,
  trustPluginHooks
} from './file-plugin-bundle-model.js';

export class FilePluginBundleStore implements PluginBundleStore {
  private readonly indexPath: string;
  private readonly pluginsDir: string;

  constructor(
    dataDir: string,
    private readonly skills: PluginSkillRegistry,
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
      ...(manifest.featuredOrder !== undefined ? { featuredOrder: manifest.featuredOrder } : {}),
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

  async installPlugin(
    input: RuntimePluginInstallInput,
    options: PluginBundleMutationOptions = {},
  ): Promise<RuntimePluginInstallResult> {
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
      const finishPluginDirectoryMutation = this.skills.beginPluginDirectoryMutation(installPath);
      try {
        await mkdir(this.pluginsDir, { recursive: true });
        await copyBundleTree(sourcePath, stagingPath);
        await renameWithRetry(stagingPath, installPath);
        for (const ownership of mcpOwnership) {
          if (!ownership.owned) continue;
          const server = mcpInputs.find((candidate) => candidate.key === ownership.key);
          if (!server) continue;
          await this.mcpStore.upsertServer(server);
          installedMcpServers.push(server.key);
        }
        if (hooks.length) {
          const nextHooks = addPluginHooks(configBefore.hooks ?? {}, hooks);
          await this.configStore.saveConfig({
            hooks: options.trustHooks
              ? trustPluginHooks(configBefore, nextHooks, manifest.id)
              : nextHooks,
          });
          hooksSaved = true;
        }
        await writeJsonFile(this.indexPath, { version: 1, plugins: [...index.plugins, record] } satisfies PluginIndexFile);
      } catch (error) {
        if (hooksSaved) await this.configStore.saveConfig({ hooks: configBefore.hooks ?? {} }).catch(() => undefined);
        await Promise.allSettled(installedMcpServers.map((key) => this.mcpStore.deleteServer(key)));
        await Promise.allSettled([rm(stagingPath, { force: true, recursive: true }), rm(installPath, { force: true, recursive: true })]);
        throw error;
      } finally {
        await finishPluginDirectoryMutation();
      }
      await Promise.allSettled(mcpOwnership.map(({ key }) => this.mcpClient.invalidateServer(key)));
      return {
        plugin: publicPluginSummary(record),
        installedMcpServers,
        reusedMcpServers: mcpOwnership.filter((item) => !item.owned).map((item) => item.key),
      };
    });
  }

  async updatePlugin(
    input: RuntimePluginInstallInput,
    options: PluginBundleMutationOptions = {},
  ): Promise<RuntimePluginInstallResult> {
    return withFileStateUpdate(this.indexPath, async () => {
      const sourcePath = await requiredBundleDirectory(input.path);
      if (pathsOverlap(sourcePath, this.pluginsDir)) {
        throw new Error('Plugin source and runtime plugin directory cannot contain one another.');
      }

      // The first pass identifies the installed plugin. The staged pass below is
      // authoritative, so a source tree changed while copying cannot bypass validation.
      await inspectBundleTree(sourcePath);
      const sourceManifest = await readPluginManifest(sourcePath);
      const index = await this.readIndex();
      const plugin = index.plugins.find((item) => item.id === sourceManifest.id);
      if (!plugin) throw new Error(`Plugin not found: ${sourceManifest.id}`);

      const expectedInstallPath = path.join(this.pluginsDir, plugin.id);
      if (path.resolve(plugin.installPath) !== path.resolve(expectedInstallPath)) {
        throw new Error(`Installed plugin path is invalid: ${plugin.id}`);
      }
      const installStat = await stat(plugin.installPath).catch(() => null);
      if (!installStat?.isDirectory()) throw new Error(`Installed plugin directory not found: ${plugin.id}`);

      await mkdir(this.pluginsDir, { recursive: true });
      const operationId = randomUUID();
      const stagingPath = path.join(this.pluginsDir, `.${plugin.id}.${operationId}.tmp`);
      const backupPath = path.join(this.pluginsDir, `.${plugin.id}.${operationId}.backup`);
      const failedPath = path.join(this.pluginsDir, `.${plugin.id}.${operationId}.failed`);
      let staged = true;
      const finishPluginDirectoryMutation = this.skills.beginPluginDirectoryMutation(plugin.installPath);

      try {
        await copyBundleTree(sourcePath, stagingPath);
        await inspectBundleTree(stagingPath);
        const manifest = await readPluginManifest(await realpath(stagingPath));
        if (manifest.id !== sourceManifest.id) {
          throw new Error('Plugin manifest id changed while staging the update.');
        }

        const ownSkillIds = new Set(plugin.skillEntries.map((skill) => skill.id));
        const existingSkillIds = new Set(
          (await this.skills.listSkills()).skills
            .map((skill) => skill.id)
            .filter((skillId) => !ownSkillIds.has(skillId)),
        );
        const conflictingSkill = manifest.skillEntries.find((skill) => existingSkillIds.has(skill.id));
        if (conflictingSkill) {
          throw new Error(`Plugin skill id conflicts with an existing skill: ${conflictingSkill.id}`);
        }

        const installPath = plugin.installPath;
        const installedManifestPath = path.join(installPath, PLUGIN_MANIFEST_RELATIVE_PATH);
        const nextMcpInputs = manifest.mcpServers.map((server) => materializePluginMcpServer(server, installPath));
        const currentServers = await this.mcpStore.listServerInputs();
        const currentServerByKey = new Map(currentServers.map((server) => [server.key, server]));
        const oldOwnershipByKey = new Map(plugin.mcpServers.map((server) => [server.key, server]));
        const oldInputByKey = new Map(plugin.mcpServerInputs.map((server) => [server.key, server]));
        const nextMcpKeys = new Set(nextMcpInputs.map((server) => server.key));
        const mcpActions: PluginMcpUpdateAction[] = [];
        const nextMcpOwnership: Array<{ key: string; owned: boolean }> = [];
        const installedMcpServers: string[] = [];
        const reusedMcpServers: string[] = [];

        for (const server of nextMcpInputs) {
          const oldOwnership = oldOwnershipByKey.get(server.key);
          const oldExpected = oldInputByKey.get(server.key);
          const current = currentServerByKey.get(server.key);

          if (oldOwnership?.owned) {
            nextMcpOwnership.push({ key: server.key, owned: true });
            // Missing or changed plugin-owned entries are user changes. Keep them
            // untouched; the new expected input still lets removal preserve them.
            if (current && oldExpected && pluginMcpServerUnmodified(current, oldExpected)
              && !pluginMcpServerUnmodified(current, server)) {
              mcpActions.push({ type: 'replace', server });
            }
            continue;
          }

          if (current) {
            if (!compatibleMcpServer(current, server)) {
              throw new Error(`Plugin MCP server conflicts with existing key: ${server.key}`);
            }
            nextMcpOwnership.push({ key: server.key, owned: false });
            reusedMcpServers.push(server.key);
            continue;
          }

          nextMcpOwnership.push({ key: server.key, owned: true });
          mcpActions.push({ type: 'upsert', server });
          installedMcpServers.push(server.key);
        }

        for (const oldOwnership of plugin.mcpServers) {
          if (!oldOwnership.owned || nextMcpKeys.has(oldOwnership.key)) continue;
          const current = currentServerByKey.get(oldOwnership.key);
          const oldExpected = oldInputByKey.get(oldOwnership.key);
          if (current && oldExpected && pluginMcpServerUnmodified(current, oldExpected)) {
            mcpActions.push({ type: 'delete', key: oldOwnership.key });
          }
        }

        const hooks = manifest.hooks.map((hook) => (
          materializePluginHook(hook, manifest.id, installPath, installedManifestPath)
        ));
        const configBefore = await this.configStore.getConfig();
        const shouldSaveHooks = Boolean(plugin.hookCount || hooks.length);
        const nextHooks = shouldSaveHooks
          ? addPluginHooks(
            removePluginHooks(configBefore.hooks ?? {}, plugin.id, plugin.manifestPath),
            hooks,
          )
          : configBefore.hooks ?? {};
        const savedHooks = options.trustHooks
          ? trustPluginHooks(configBefore, nextHooks, manifest.id)
          : nextHooks;
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
          installedAt: plugin.installedAt,
          manifestPath: installedManifestPath,
          skills: manifest.skillEntries.map((skill): RuntimePluginSkill => ({
            id: skill.id,
            name: skill.name,
            ...(skill.description ? { description: skill.description } : {}),
          })),
          skillEntries: manifest.skillEntries.map(({ id, relativePath }) => ({ id, relativePath })),
          mcpServers: nextMcpOwnership.map((ownership) => {
            const server = nextMcpInputs.find((candidate) => candidate.key === ownership.key)!;
            return { ...pluginMcpServerDescriptor(server), owned: ownership.owned };
          }),
          mcpServerInputs: nextMcpInputs,
          hooks: manifest.hooks.map(pluginHookDescriptor),
          hookCount: hooks.length,
          resources: manifest.resources.map((resource) => ({ ...resource })),
        };

        let oldDirectoryMoved = false;
        let newDirectoryActivated = false;
        let hookSaveStarted = false;
        let indexSaveStarted = false;
        const mcpActionsStarted: PluginMcpUpdateAction[] = [];
        try {
          await renameWithRetry(installPath, backupPath);
          oldDirectoryMoved = true;
          await renameWithRetry(stagingPath, installPath);
          staged = false;
          newDirectoryActivated = true;

          for (const action of mcpActions) {
            mcpActionsStarted.push(action);
            if (action.type === 'replace') {
              await this.mcpStore.deleteServer(action.server.key);
              await this.mcpStore.upsertServer(action.server);
            } else if (action.type === 'upsert') {
              await this.mcpStore.upsertServer(action.server);
            } else {
              await this.mcpStore.deleteServer(action.key);
            }
          }
          if (shouldSaveHooks) {
            hookSaveStarted = true;
            // Generic local updates clear trust because scripts may change while
            // commands stay identical. The bundled marketplace opts back into trust.
            await this.configStore.saveConfig({ hooks: savedHooks });
          }
          indexSaveStarted = true;
          await writeJsonFile(this.indexPath, {
            version: 1,
            plugins: index.plugins.map((item) => item.id === plugin.id ? record : item),
          } satisfies PluginIndexFile);
        } catch (error) {
          const rollbackErrors: unknown[] = [];
          if (hookSaveStarted) {
            await this.configStore.saveConfig({ hooks: configBefore.hooks ?? {} })
              .catch((rollbackError) => rollbackErrors.push(rollbackError));
          }
          for (const action of [...mcpActionsStarted].reverse()) {
            const key = action.type === 'delete' ? action.key : action.server.key;
            const previous = currentServerByKey.get(key);
            const rollback = previous
              ? this.mcpStore.upsertServer(previous)
              : this.mcpStore.deleteServer(key);
            await rollback.catch((rollbackError) => rollbackErrors.push(rollbackError));
          }
          if (newDirectoryActivated) {
            await renameWithRetry(installPath, failedPath).catch(async (renameError) => {
              await rm(installPath, { recursive: true, force: true })
                .catch((removeError) => rollbackErrors.push(new AggregateError(
                  [renameError, removeError],
                  'Could not move or remove the failed plugin update.',
                )));
            });
          }
          if (oldDirectoryMoved) {
            await renameWithRetry(backupPath, installPath)
              .catch((rollbackError) => rollbackErrors.push(rollbackError));
          }
          if (indexSaveStarted) {
            await writeJsonFile(this.indexPath, index)
              .catch((rollbackError) => rollbackErrors.push(rollbackError));
          }
          await Promise.allSettled([
            rm(stagingPath, { recursive: true, force: true }),
            rm(failedPath, { recursive: true, force: true }),
          ]);
          await Promise.allSettled(
            [...new Set([...plugin.mcpServers.map(({ key }) => key), ...nextMcpInputs.map(({ key }) => key)])]
              .map((key) => this.mcpClient.invalidateServer(key)),
          );
          if (rollbackErrors.length) {
            throw new AggregateError([error, ...rollbackErrors], 'Plugin update failed and rollback was incomplete.');
          }
          throw error;
        }

        await rm(backupPath, { recursive: true, force: true }).catch(() => undefined);
        await Promise.allSettled(
          [...new Set([...plugin.mcpServers.map(({ key }) => key), ...nextMcpInputs.map(({ key }) => key)])]
            .map((key) => this.mcpClient.invalidateServer(key)),
        );
        return {
          plugin: publicPluginSummary(record),
          installedMcpServers,
          reusedMcpServers,
        };
      } finally {
        if (staged) await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
        await finishPluginDirectoryMutation();
      }
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
      const finishPluginDirectoryMutation = this.skills.beginPluginDirectoryMutation(plugin.installPath);
      let directoryMoved = false;
      const removedMcpServers: string[] = [];
      try {
        if (installExists) {
          await renameWithRetry(plugin.installPath, removalPath);
          directoryMoved = true;
        }
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
        if (directoryMoved) await renameWithRetry(removalPath, plugin.installPath).catch(() => undefined);
        await Promise.allSettled(plugin.mcpServers.map(({ key }) => this.mcpClient.invalidateServer(key)));
        throw error;
      } finally {
        await finishPluginDirectoryMutation();
      }
      if (directoryMoved) await rm(removalPath, { recursive: true, force: true }).catch(() => undefined);
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
