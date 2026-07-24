import path from 'node:path';

export const DATA_ROOT_MARKER_FILE_NAME = '.setsuna-data-root.json';
export const DATA_MIGRATION_OWNER_FILE_NAME = '.setsuna-data-migration.json';
export const LEGACY_DATA_IMPORT_RECEIPT_FILE_NAME = '.setsuna-legacy-data-import.json';
export const LEGACY_MEMORY_IMPORT_RECEIPT_FILE_NAME = '.setsuna-memory-legacy-import.json';

/** Centralized paths owned by Electron main beneath the selected desktop data root. */
export function desktopDataLayout(dataRoot: string) {
  const root = path.resolve(dataRoot);
  const runtimeRoot = path.join(root, 'runtime');
  const pcLocalPoliciesRoot = path.join(runtimeRoot, 'pc-local-policies');
  return {
    root,
    runtimeRoot,
    pcLocalPoliciesRoot,
    pcLocalExecPolicyPath: path.join(pcLocalPoliciesRoot, 'legacy-exec-policy.json'),
    pcLocalShellPolicyPath: path.join(pcLocalPoliciesRoot, 'legacy-shell-policy.json'),
    legacyDataImportReceiptPath: path.join(runtimeRoot, LEGACY_DATA_IMPORT_RECEIPT_FILE_NAME),
    generatedImagesRoot: path.join(runtimeRoot, 'generated-images'),
    memoriesRoot: path.join(runtimeRoot, 'memories'),
    runtimeConfigPath: path.join(runtimeRoot, 'config.json'),
    runtimeDatabasePath: path.join(runtimeRoot, 'threads.sqlite'),
    credentialVaultPath: path.join(root, 'secure-credentials.json'),
    updateSourcesPath: path.join(root, 'update-download-sources.json'),
    windowStatePath: path.join(root, 'window-state.json'),
    markerPath: path.join(root, DATA_ROOT_MARKER_FILE_NAME),
  };
}

export function dataRootBootstrapLayout(appDataRoot: string) {
  const root = path.join(path.resolve(appDataRoot), 'Setsuna Desktop Bootstrap');
  return {
    root,
    instanceLockRoot: path.join(root, 'instance.lock'),
    pointerPath: path.join(root, 'data-root.json'),
    pendingMigrationPath: path.join(root, 'pending-migration.json'),
  };
}

export function legacyDesktopPolicyPaths(homeRoot: string) {
  const legacyRoot = path.join(path.resolve(homeRoot), '.setsuna', 'desktop');
  return {
    execPolicyPath: path.join(legacyRoot, 'exec-policy.json'),
    shellPolicyPath: path.join(legacyRoot, 'shell-policy.json'),
  };
}
