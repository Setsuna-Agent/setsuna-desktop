import type {
  RuntimeExtensionStatus,
  RuntimePluginFilePreview,
  RuntimePluginInstallResult,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginList,
  RuntimePluginMarketplaceItem,
  RuntimePluginRemoveResult,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type {
  PluginManagementExtensionSnapshot,
  PluginManagementExtensionTrustInput,
  PluginManagementItemTarget,
  PluginManagementLocalInstallInput,
  PluginManagementPluginTarget,
  PluginManagementSnapshot,
} from './types.js';

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (isRecord(value) && !Object.keys(value).length) return undefined;
  throw new Error('Plugin management snapshot does not accept input.');
});

const pluginTargetCodec = defineRuntimeCodec<PluginManagementPluginTarget>((value) => {
  const record = objectRecord(value, 'Plugin target must be an object.');
  return Object.freeze({ pluginId: nonEmptyText(record.pluginId, 'pluginId') });
});

const itemTargetCodec = defineRuntimeCodec<PluginManagementItemTarget>((value) => {
  const record = objectRecord(value, 'Plugin item target must be an object.');
  return Object.freeze({
    itemId: nonEmptyText(record.itemId, 'itemId'),
    kind: pluginItemKind(record.kind),
    pluginId: nonEmptyText(record.pluginId, 'pluginId'),
  });
});

const localInstallCodec = defineRuntimeCodec<PluginManagementLocalInstallInput>((value) => {
  const record = objectRecord(value, 'Local Plugin install input must be an object.');
  return Object.freeze({ path: nonEmptyText(record.path, 'path') });
});

const extensionTrustCodec = defineRuntimeCodec<PluginManagementExtensionTrustInput>((value) => {
  const record = objectRecord(value, 'Plugin extension trust input must be an object.');
  if (typeof record.trusted !== 'boolean') throw new Error('Plugin extension trust must be boolean.');
  return Object.freeze({
    pluginId: nonEmptyText(record.pluginId, 'pluginId'),
    trusted: record.trusted,
  });
});

const snapshotCodec = defineRuntimeCodec<PluginManagementSnapshot>((value) => {
  const record = objectRecord(value, 'Plugin management snapshot must be an object.');
  return Object.freeze({
    catalogRevision: nonEmptyText(record.catalogRevision, 'catalogRevision'),
    extensions: Object.freeze(arrayValue(record.extensions, 'extensions').map(extensionStatus)),
    marketplace: Object.freeze(arrayValue(record.marketplace, 'marketplace').map(marketplaceItem)),
    marketplaceErrors: Object.freeze(arrayValue(record.marketplaceErrors, 'marketplaceErrors').map((item) => (
      text(item, 'marketplace error')
    ))),
    plugins: Object.freeze(arrayValue(record.plugins, 'plugins').map(pluginSummary)),
  });
});

const itemContentCodec = defineRuntimeCodec<RuntimePluginItemContent>((value) => {
  const record = objectRecord(value, 'Plugin item content must be an object.');
  return {
    files: arrayValue(record.files, 'files').map(pluginFilePreview),
    itemId: nonEmptyText(record.itemId, 'itemId'),
    kind: pluginItemKind(record.kind),
    pluginId: nonEmptyText(record.pluginId, 'pluginId'),
  };
});

const installResultCodec = defineRuntimeCodec<RuntimePluginInstallResult>((value) => {
  const record = objectRecord(value, 'Plugin install result must be an object.');
  return {
    installedMcpServers: stringArray(record.installedMcpServers, 'installedMcpServers'),
    plugin: pluginSummary(record.plugin),
    reusedMcpServers: stringArray(record.reusedMcpServers, 'reusedMcpServers'),
  };
});

const removeResultCodec = defineRuntimeCodec<RuntimePluginRemoveResult>((value) => {
  const record = objectRecord(value, 'Plugin removal result must be an object.');
  return {
    pluginId: nonEmptyText(record.pluginId, 'pluginId'),
    preservedMcpServers: stringArray(record.preservedMcpServers, 'preservedMcpServers'),
    removedMcpServers: stringArray(record.removedMcpServers, 'removedMcpServers'),
  };
});

const pluginListCodec = defineRuntimeCodec<RuntimePluginList>((value) => {
  const record = objectRecord(value, 'Plugin list must be an object.');
  return { plugins: arrayValue(record.plugins, 'plugins').map(pluginSummary) };
});

const extensionStatusListCodec = defineRuntimeCodec<PluginManagementExtensionSnapshot>((value) => {
  const record = objectRecord(value, 'Plugin extension status list must be an object.');
  return {
    catalogRevision: nonEmptyText(record.catalogRevision, 'catalogRevision'),
    extensions: arrayValue(record.extensions, 'extensions').map(extensionStatus),
  };
});

// Plugin adapters expose actionable validation and catalog messages as Error.
// Declare one stable boundary code so the Feature transport can preserve those
// messages without coupling contracts to adapter-specific error classes.
const pluginOperationErrors = Object.freeze({
  PLUGIN_OPERATION_FAILED: Object.freeze({ status: 500 }),
});

export const readPluginManagementSnapshot = defineFeatureOperation({
  id: 'plugin-management.snapshot.read',
  method: 'GET',
  path: '/v1/features/plugin-management',
  input: emptyInputCodec,
  output: snapshotCodec,
  errors: Object.freeze({}),
  idempotency: 'safe',
});

export const readPluginExtensionStatuses = defineFeatureOperation({
  id: 'plugin-management.extension-statuses.read',
  method: 'GET',
  path: '/v1/features/plugin-management/extensions',
  input: emptyInputCodec,
  output: extensionStatusListCodec,
  errors: Object.freeze({}),
  idempotency: 'safe',
});

export const readInstalledPlugins = defineFeatureOperation({
  id: 'plugin-management.installed.read',
  method: 'GET',
  path: '/v1/features/plugin-management/installed',
  input: emptyInputCodec,
  output: pluginListCodec,
  errors: Object.freeze({}),
  idempotency: 'safe',
});

export const readInstalledPluginItem = defineFeatureOperation({
  id: 'plugin-management.installed-item.read',
  method: 'GET',
  path: '/v1/features/plugin-management/installed/:pluginId/items/:kind/:itemId',
  input: itemTargetCodec,
  output: itemContentCodec,
  errors: pluginOperationErrors,
  idempotency: 'safe',
});

export const readMarketplacePluginItem = defineFeatureOperation({
  id: 'plugin-management.marketplace-item.read',
  method: 'GET',
  path: '/v1/features/plugin-management/marketplace/:pluginId/items/:kind/:itemId',
  input: itemTargetCodec,
  output: itemContentCodec,
  errors: pluginOperationErrors,
  idempotency: 'safe',
});

export const installLocalPlugin = defineFeatureOperation({
  id: 'plugin-management.local.install',
  method: 'POST',
  path: '/v1/features/plugin-management/install-local',
  input: localInstallCodec,
  output: installResultCodec,
  errors: pluginOperationErrors,
  idempotency: 'non-idempotent',
});

export const installMarketplacePlugin = defineFeatureOperation({
  id: 'plugin-management.marketplace.install',
  method: 'POST',
  path: '/v1/features/plugin-management/marketplace/:pluginId/install',
  input: pluginTargetCodec,
  output: installResultCodec,
  errors: pluginOperationErrors,
  idempotency: 'non-idempotent',
});

export const updateMarketplacePlugin = defineFeatureOperation({
  id: 'plugin-management.marketplace.update',
  method: 'POST',
  path: '/v1/features/plugin-management/marketplace/:pluginId/update',
  input: pluginTargetCodec,
  output: installResultCodec,
  errors: pluginOperationErrors,
  idempotency: 'non-idempotent',
});

export const removeInstalledPlugin = defineFeatureOperation({
  id: 'plugin-management.installed.remove',
  method: 'DELETE',
  path: '/v1/features/plugin-management/installed/:pluginId',
  input: pluginTargetCodec,
  output: removeResultCodec,
  errors: pluginOperationErrors,
  idempotency: 'idempotent',
});

export const setInstalledPluginExtensionTrust = defineFeatureOperation({
  id: 'plugin-management.extension-trust.update',
  method: 'PUT',
  path: '/v1/features/plugin-management/installed/:pluginId/extension-trust',
  input: extensionTrustCodec,
  output: pluginListCodec,
  errors: pluginOperationErrors,
  idempotency: 'idempotent',
});

function pluginSummary(value: unknown): RuntimePluginSummary {
  const record = objectRecord(value, 'Plugin summary must be an object.');
  nonEmptyText(record.id, 'plugin id');
  text(record.name, 'plugin name');
  text(record.installedAt, 'plugin installedAt');
  arrayValue(record.skills, 'plugin skills');
  arrayValue(record.mcpServers, 'plugin mcpServers');
  arrayValue(record.hooks, 'plugin hooks');
  arrayValue(record.resources, 'plugin resources');
  if (!Number.isSafeInteger(record.hookCount) || (record.hookCount as number) < 0) {
    throw new Error('Plugin hookCount is invalid.');
  }
  return Object.freeze({ ...record }) as RuntimePluginSummary;
}

function marketplaceItem(value: unknown): RuntimePluginMarketplaceItem {
  const record = objectRecord(value, 'Plugin marketplace item must be an object.');
  nonEmptyText(record.id, 'marketplace plugin id');
  text(record.name, 'marketplace plugin name');
  arrayValue(record.tags, 'marketplace plugin tags');
  arrayValue(record.skills, 'marketplace plugin skills');
  arrayValue(record.mcpServers, 'marketplace plugin mcpServers');
  arrayValue(record.hooks, 'marketplace plugin hooks');
  arrayValue(record.resources, 'marketplace plugin resources');
  objectRecord(record.capabilities, 'Marketplace plugin capabilities must be an object.');
  if (typeof record.featured !== 'boolean' || typeof record.installed !== 'boolean' || typeof record.updateAvailable !== 'boolean') {
    throw new Error('Marketplace plugin state is invalid.');
  }
  return Object.freeze({ ...record }) as RuntimePluginMarketplaceItem;
}

function extensionStatus(value: unknown): RuntimeExtensionStatus {
  const record = objectRecord(value, 'Extension status must be an object.');
  nonEmptyText(record.pluginId, 'extension pluginId');
  if (record.state !== 'stopped' && record.state !== 'starting' && record.state !== 'running' && record.state !== 'failed') {
    throw new Error('Extension status state is invalid.');
  }
  arrayValue(record.tools, 'extension tools');
  arrayValue(record.events, 'extension events');
  return Object.freeze({ ...record }) as RuntimeExtensionStatus;
}

function pluginFilePreview(value: unknown): RuntimePluginFilePreview {
  const record = objectRecord(value, 'Plugin file preview must be an object.');
  const size = record.size;
  if (!Number.isSafeInteger(size) || (size as number) < 0) throw new Error('Plugin file size is invalid.');
  return Object.freeze({
    path: nonEmptyText(record.path, 'file path'),
    size: size as number,
    mimeType: nonEmptyText(record.mimeType, 'file mimeType'),
    ...(typeof record.text === 'string' ? { text: record.text } : {}),
    ...(typeof record.base64 === 'string' ? { base64: record.base64 } : {}),
  });
}

function pluginItemKind(value: unknown): RuntimePluginItemKind {
  if (value === 'skill' || value === 'mcp' || value === 'hook' || value === 'resource') return value;
  throw new Error('Plugin item kind is invalid.');
}

function stringArray(value: unknown, label: string): string[] {
  return arrayValue(value, label).map((item) => nonEmptyText(item, label));
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Plugin management ${label} must be an array.`);
  return value;
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Plugin management ${label} is invalid.`);
  return value;
}

function nonEmptyText(value: unknown, label: string): string {
  const result = text(value, label);
  if (!result.trim()) throw new Error(`Plugin management ${label} must not be empty.`);
  return result;
}
