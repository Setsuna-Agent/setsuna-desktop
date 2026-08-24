import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  defineFeatureSettingsBundle,
  defineFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import { workspaceDependenciesFeature } from './definition.js';

export const DEFAULT_NPM_REGISTRY_URL = 'https://registry.npmmirror.com';
export const DEFAULT_PYTHON_PACKAGE_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple';

export type WorkspaceDependencySettings = Readonly<{
  npmRegistryUrl: string;
  pythonPackageIndexUrl: string;
}>;

export type WorkspaceDependencySettingsPatch = Readonly<{
  npmRegistryUrl?: string;
  pythonPackageIndexUrl?: string;
}>;

export type WorkspaceDependencySettingsState = Readonly<{
  value: WorkspaceDependencySettings;
  revision: number;
}>;

export const DEFAULT_WORKSPACE_DEPENDENCY_SETTINGS: WorkspaceDependencySettings = Object.freeze({
  npmRegistryUrl: DEFAULT_NPM_REGISTRY_URL,
  pythonPackageIndexUrl: DEFAULT_PYTHON_PACKAGE_INDEX_URL,
});

export function normalizeNpmRegistryUrl(value: unknown): string | null {
  return normalizePackageSourceUrl(value);
}

export function normalizePythonPackageIndexUrl(value: unknown): string | null {
  return normalizePackageSourceUrl(value);
}

export const workspaceDependencySettingsCodec = defineRuntimeCodec<WorkspaceDependencySettings>((value) => {
  const record = objectRecord(value, 'Workspace dependency settings must be an object.');
  return Object.freeze({
    npmRegistryUrl: requiredPackageSource(record.npmRegistryUrl, 'npmRegistryUrl'),
    pythonPackageIndexUrl: requiredPackageSource(record.pythonPackageIndexUrl, 'pythonPackageIndexUrl'),
  });
});

export const workspaceDependencySettingsPatchCodec = defineRuntimeCodec<WorkspaceDependencySettingsPatch>((value) => {
  const record = objectRecord(value, 'Workspace dependency settings patch must be an object.');
  return Object.freeze({
    ...optionalPackageSource(record, 'npmRegistryUrl'),
    ...optionalPackageSource(record, 'pythonPackageIndexUrl'),
  });
});

const preferencesDocument = defineFeatureSettingsDocument<
  WorkspaceDependencySettings,
  WorkspaceDependencySettings,
  WorkspaceDependencySettingsPatch,
  undefined
>({
  currentVersion: 1,
  schema: workspaceDependencySettingsCodec,
  defaults: () => DEFAULT_WORKSPACE_DEPENDENCY_SETTINGS,
  migrations: Object.freeze({}),
  publicProjection: (value) => value,
  applyPatch: (value, patch) => workspaceDependencySettingsCodec.parse({ ...value, ...patch }),
  secretNames: [],
  normalizeSecretPatch: () => Object.freeze({}),
  syncPolicy: 'portable',
});

export const workspaceDependencyFeatureSettings = defineFeatureSettingsBundle({
  featureId: workspaceDependenciesFeature.id,
  documents: { preferences: preferencesDocument },
});

function normalizePackageSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function requiredPackageSource(value: unknown, label: string): string {
  const normalized = normalizePackageSourceUrl(value);
  if (!normalized) throw new Error(`Workspace dependency ${label} must be an HTTP or HTTPS URL.`);
  return normalized;
}

function optionalPackageSource(
  record: Record<string, unknown>,
  key: keyof WorkspaceDependencySettingsPatch,
): Partial<WorkspaceDependencySettingsPatch> {
  if (!Object.hasOwn(record, key)) return {};
  const normalized = normalizePackageSourceUrl(record[key]);
  if (!normalized) throw new Error(`Workspace dependency ${key} must be an HTTP or HTTPS URL.`);
  return { [key]: normalized };
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
