import type { RuntimeDesktopSettings } from '@setsuna-desktop/contracts';
import {
  DEFAULT_NPM_REGISTRY_URL,
  DEFAULT_PYTHON_PACKAGE_INDEX_URL,
  normalizeNpmRegistryUrl,
  normalizePythonPackageIndexUrl,
  type WorkspaceDependencySettings,
} from '@setsuna-desktop/feature-workspace-dependencies/contracts';

export type StoredDesktopSettings = RuntimeDesktopSettings & {
  /** Compatibility input consumed once by the Workspace Dependencies Feature. */
  npmRegistryUrl?: unknown;
  pythonPackageIndexUrl?: unknown;
  workspaceDependenciesEnabled?: unknown;
};

const LEGACY_KEYS = [
  'npmRegistryUrl',
  'pythonPackageIndexUrl',
  'workspaceDependenciesEnabled',
] as const;

export function workspaceDependencySettingsFromLegacy(
  value: StoredDesktopSettings | undefined,
): WorkspaceDependencySettings {
  return Object.freeze({
    npmRegistryUrl: normalizeNpmRegistryUrl(value?.npmRegistryUrl) || DEFAULT_NPM_REGISTRY_URL,
    pythonPackageIndexUrl:
      normalizePythonPackageIndexUrl(value?.pythonPackageIndexUrl) || DEFAULT_PYTHON_PACKAGE_INDEX_URL,
  });
}

export function legacyWorkspaceDependencySettingsForSave(
  value: StoredDesktopSettings | undefined,
): Partial<StoredDesktopSettings> {
  if (!value) return {};
  return Object.fromEntries(
    LEGACY_KEYS.flatMap((key) => Object.hasOwn(value, key) ? [[key, value[key]]] : []),
  );
}

export function stripLegacyWorkspaceDependencySettings(
  value: StoredDesktopSettings,
): RuntimeDesktopSettings {
  const settings = { ...value };
  for (const key of LEGACY_KEYS) delete settings[key];
  return settings;
}

export function retireLegacyWorkspaceDependencySettings(
  value: StoredDesktopSettings | undefined,
): Readonly<{ changed: boolean; value: StoredDesktopSettings }> {
  const changed = Boolean(value && LEGACY_KEYS.some((key) => Object.hasOwn(value, key)));
  return Object.freeze({
    changed,
    value: stripLegacyWorkspaceDependencySettings(value ?? {}),
  });
}
