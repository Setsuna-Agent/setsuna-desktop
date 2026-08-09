import path from 'node:path';
import { withFileStateUpdate } from '../adapters/store/file-state-coordinator.js';
import { readJsonFile, writeJsonFile } from '../adapters/store/json-file.js';
import type { ExtensionStateStore } from '../ports/extension-runtime.js';

type ExtensionStateFile = {
  version: 1;
  plugins: Record<string, Record<string, Record<string, unknown>>>;
};

const MAX_VALUE_BYTES = 64 * 1024;
const MAX_SCOPE_STATE_BYTES = 1024 * 1024;

export class FileExtensionStateStore implements ExtensionStateStore {
  private readonly statePath: string;

  constructor(dataDir: string) {
    this.statePath = path.join(dataDir, 'extension-state.json');
  }

  async get(pluginId: string, scope: string, key: string): Promise<unknown> {
    validateKey(key);
    const state = await this.read();
    const scoped = state.plugins[pluginId]?.[scope];
    return scoped && Object.hasOwn(scoped, key) ? cloneJsonValue(scoped[key]) : undefined;
  }

  async set(pluginId: string, scope: string, key: string, value: unknown): Promise<void> {
    validateKey(key);
    const cloned = cloneJsonValue(value, true);
    if (Buffer.byteLength(JSON.stringify(cloned), 'utf8') > MAX_VALUE_BYTES) {
      throw new Error(`Extension state value exceeds ${MAX_VALUE_BYTES} bytes.`);
    }
    await withFileStateUpdate(this.statePath, async () => {
      const state = await this.read();
      const plugin = state.plugins[pluginId] ?? {};
      const scoped = plugin[scope] ?? {};
      const nextScoped = { ...scoped, [key]: cloned };
      if (Buffer.byteLength(JSON.stringify(nextScoped), 'utf8') > MAX_SCOPE_STATE_BYTES) {
        throw new Error(`Extension state exceeds ${MAX_SCOPE_STATE_BYTES} bytes for ${pluginId} in ${scope}.`);
      }
      const nextPlugin = { ...plugin, [scope]: nextScoped };
      await writeJsonFile(this.statePath, {
        version: 1,
        plugins: { ...state.plugins, [pluginId]: nextPlugin },
      } satisfies ExtensionStateFile);
    });
  }

  async delete(pluginId: string, scope: string, key: string): Promise<void> {
    validateKey(key);
    await withFileStateUpdate(this.statePath, async () => {
      const state = await this.read();
      const plugin = state.plugins[pluginId];
      const scoped = plugin?.[scope];
      if (!plugin || !scoped || !Object.hasOwn(scoped, key)) return;
      const nextScoped = { ...scoped };
      delete nextScoped[key];
      const nextPlugin = { ...plugin };
      if (Object.keys(nextScoped).length) nextPlugin[scope] = nextScoped;
      else delete nextPlugin[scope];
      const plugins = { ...state.plugins };
      if (Object.keys(nextPlugin).length) plugins[pluginId] = nextPlugin;
      else delete plugins[pluginId];
      await writeJsonFile(this.statePath, { version: 1, plugins } satisfies ExtensionStateFile);
    });
  }

  async deletePlugin(pluginId: string): Promise<void> {
    await withFileStateUpdate(this.statePath, async () => {
      const state = await this.read();
      if (!Object.hasOwn(state.plugins, pluginId)) return;
      const plugins = { ...state.plugins };
      delete plugins[pluginId];
      await writeJsonFile(this.statePath, { version: 1, plugins } satisfies ExtensionStateFile);
    });
  }

  private async read(): Promise<ExtensionStateFile> {
    const value = await readJsonFile<Partial<ExtensionStateFile>>(this.statePath, {});
    const plugins = value.plugins && typeof value.plugins === 'object' && !Array.isArray(value.plugins)
      ? value.plugins as ExtensionStateFile['plugins']
      : {};
    return { version: 1, plugins };
  }
}

function validateKey(key: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(key)) {
    throw new Error('Extension state key is invalid.');
  }
}

function cloneJsonValue(value: unknown, required = false): unknown {
  if (value === undefined) {
    if (required) throw new Error('Extension state value must be JSON serializable.');
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch (error) {
    throw new Error('Extension state value must be JSON serializable.', { cause: error });
  }
}
