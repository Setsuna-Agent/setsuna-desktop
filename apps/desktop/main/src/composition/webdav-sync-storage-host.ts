import {
  finalizeCommittedWebDavRestore,
  recoverInterruptedWebDavRestore,
  rollbackCommittedWebDavRestore,
  type WebDavSyncLifecycle,
  type WebDavSyncStorageHost,
} from '@setsuna-desktop/feature-webdav-sync/main';
import {
  removeFileDurably,
  syncDirectoryDurably,
  writeJsonAtomically,
} from '../data-root/atomic-json.js';
import { desktopDataLayout } from '../data-root/layout.js';
import { relocateDataRootContents } from '../data-root/relocate.js';

/** Keeps desktop-owned data layout and durable filesystem behavior out of the Feature package. */
export const desktopWebDavSyncStorageHost: WebDavSyncStorageHost = Object.freeze({
  dataLayout(dataRoot: string) {
    const layout = desktopDataLayout(dataRoot);
    return Object.freeze({
      generatedImagesRoot: layout.generatedImagesRoot,
      memoriesRoot: layout.memoriesRoot,
      runtimeConfigPath: layout.runtimeConfigPath,
      runtimeDatabasePath: layout.runtimeDatabasePath,
      runtimeRoot: layout.runtimeRoot,
      toolResultsRoot: layout.toolResultsRoot,
    });
  },
  relocateDataRootContents,
  removeFileDurably,
  syncDirectoryDurably,
  writeJsonAtomically,
});

export {
  finalizeCommittedWebDavRestore,
  recoverInterruptedWebDavRestore,
  rollbackCommittedWebDavRestore,
};
export type DesktopWebDavSyncLifecycle = WebDavSyncLifecycle;
