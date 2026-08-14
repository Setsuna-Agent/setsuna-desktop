import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { InstalledPluginRecord } from '../../ports/plugin-bundle-store.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';

type PluginSkillOverrideMarker = {
  version: 1;
  pluginId: string;
  installedAt: string;
  deleted?: boolean;
};

export type PluginSkillOverride = {
  deleted: boolean;
  skillPath?: string;
};

const MARKER_FILE_NAME = 'origin.json';

/** Keeps editable Plugin Skill copies outside the integrity-checked bundle. */
export class PluginSkillOverrideStore {
  constructor(private readonly root: string) {}

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async read(
    plugin: InstalledPluginRecord,
    skillId: string,
  ): Promise<PluginSkillOverride | null> {
    const overrideDirectory = this.overrideDirectory(plugin.id, skillId);
    const marker = await readJsonFile<PluginSkillOverrideMarker | null>(
      path.join(overrideDirectory, MARKER_FILE_NAME),
      null,
    );
    if (!marker
      || marker.version !== 1
      || marker.pluginId !== plugin.id
      || marker.installedAt !== plugin.installedAt) {
      return null;
    }
    return marker.deleted
      ? { deleted: true }
      : { deleted: false, skillPath: path.join(overrideDirectory, 'SKILL.md') };
  }

  async write(
    plugin: InstalledPluginRecord,
    skillId: string,
    sourceSkillPath: string,
    updateFiles: (overrideSkillPath: string) => Promise<void>,
  ): Promise<void> {
    const overrideDirectory = this.overrideDirectory(plugin.id, skillId);
    const current = await this.read(plugin, skillId);
    if (!current || current.deleted || !await isDirectory(overrideDirectory)) {
      await rm(overrideDirectory, { recursive: true, force: true });
      await mkdir(path.dirname(overrideDirectory), { recursive: true });
      // Copy the complete Skill directory so relative references remain usable.
      await cp(path.dirname(sourceSkillPath), overrideDirectory, { recursive: true });
    }
    await updateFiles(path.join(overrideDirectory, 'SKILL.md'));
    await writeJsonFile(
      path.join(overrideDirectory, MARKER_FILE_NAME),
      overrideMarker(plugin),
    );
  }

  async markDeleted(plugin: InstalledPluginRecord, skillId: string): Promise<void> {
    const overrideDirectory = this.overrideDirectory(plugin.id, skillId);
    await rm(overrideDirectory, { recursive: true, force: true });
    await mkdir(overrideDirectory, { recursive: true });
    await writeJsonFile(
      path.join(overrideDirectory, MARKER_FILE_NAME),
      overrideMarker(plugin, true),
    );
  }

  watchRoots(plugins: InstalledPluginRecord[]): string[] {
    return [
      this.root,
      ...plugins.flatMap((plugin) => plugin.skillEntries.map((entry) => (
        this.overrideDirectory(plugin.id, entry.id)
      ))),
    ];
  }

  private overrideDirectory(pluginId: string, skillId: string): string {
    return path.join(this.root, encodedPathSegment(pluginId), encodedPathSegment(skillId));
  }
}

function overrideMarker(
  plugin: InstalledPluginRecord,
  deleted = false,
): PluginSkillOverrideMarker {
  return {
    version: 1,
    pluginId: plugin.id,
    installedAt: plugin.installedAt,
    ...(deleted ? { deleted: true } : {}),
  };
}

function encodedPathSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

async function isDirectory(directory: string): Promise<boolean> {
  return stat(directory).then((stats) => stats.isDirectory(), () => false);
}
