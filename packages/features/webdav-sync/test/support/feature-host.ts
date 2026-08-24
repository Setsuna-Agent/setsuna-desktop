import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  WebDavSyncCredentialVault,
  WebDavSyncStorageHost,
} from '../../src/main/capabilities.js';
import { WebDavSyncConfigStore } from '../../src/main/config-store.js';

export const testWebDavSyncStorageHost: WebDavSyncStorageHost = Object.freeze({
  dataLayout(dataRoot: string) {
    const runtimeRoot = path.join(path.resolve(dataRoot), 'runtime');
    return Object.freeze({
      generatedImagesRoot: path.join(runtimeRoot, 'generated-images'),
      memoriesRoot: path.join(runtimeRoot, 'memories'),
      runtimeConfigPath: path.join(runtimeRoot, 'config.json'),
      runtimeDatabasePath: path.join(runtimeRoot, 'threads.sqlite'),
      runtimeRoot,
      toolResultsRoot: path.join(runtimeRoot, 'tool-results'),
    });
  },
  async relocateDataRootContents() {
    // Relocation is a desktop-host concern and is covered by the host adapter tests.
  },
  async removeFileDurably(filePath) {
    await rm(filePath, { force: true });
  },
  async syncDirectoryDurably() {
    // Unit tests assert transaction behavior, not platform-specific fsync support.
  },
  async writeJsonAtomically(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  },
});

export function createTestWebDavSyncConfigStore(
  configPath: string,
  credentialVault: WebDavSyncCredentialVault,
): WebDavSyncConfigStore {
  return new WebDavSyncConfigStore(configPath, credentialVault, {
    writeConfig: (filePath, value) => testWebDavSyncStorageHost.writeJsonAtomically(filePath, value),
  });
}
