import type {
  RuntimeExtensionStatus,
  RuntimeHookProtocolEventName,
  RuntimeHookSource,
  RuntimeHookTrustStatus,
  RuntimePluginFilePreview,
  RuntimePluginInstallResult,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginList,
  RuntimePluginMarketplaceItem,
  RuntimePluginRemoveResult,
  RuntimePluginSummary,
  RuntimePluginUiActionInput,
  RuntimePluginUiActionResult,
} from '@setsuna-desktop/contracts';
import { RUNTIME_PLUGIN_UI_LIMITS } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type {
  PluginManagementExtensionSnapshot,
  PluginManagementExtensionTrustInput,
  PluginManagementHook,
  PluginManagementHookQuery,
  PluginManagementHookSnapshot,
  PluginManagementHookStateInput,
  PluginManagementHookTarget,
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

const hookQueryCodec = defineRuntimeCodec<PluginManagementHookQuery>((value) => {
  const record = optionalObjectRecord(value, 'Plugin Hook query must be an object.');
  return Object.freeze({
    ...(record.cwd === undefined ? {} : { cwd: nonEmptyText(record.cwd, 'cwd') }),
  });
});

const hookTargetCodec = defineRuntimeCodec<PluginManagementHookTarget>((value) => {
  const record = objectRecord(value, 'Plugin Hook target must be an object.');
  return Object.freeze({
    currentHash: nonEmptyText(record.currentHash, 'currentHash'),
    managementId: nonEmptyText(record.managementId, 'managementId'),
    ...(record.cwd === undefined ? {} : { cwd: nonEmptyText(record.cwd, 'cwd') }),
  });
});

const hookStateCodec = defineRuntimeCodec<PluginManagementHookStateInput>((value) => {
  const record = objectRecord(value, 'Plugin Hook state input must be an object.');
  if (record.enabled === undefined && record.trusted === undefined) {
    throw new Error('Plugin Hook state input must contain a mutation.');
  }
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    throw new Error('Plugin Hook enabled state must be boolean.');
  }
  if (record.trusted !== undefined && typeof record.trusted !== 'boolean') {
    throw new Error('Plugin Hook trust state must be boolean.');
  }
  return Object.freeze({
    currentHash: nonEmptyText(record.currentHash, 'currentHash'),
    managementId: nonEmptyText(record.managementId, 'managementId'),
    ...(record.cwd === undefined ? {} : { cwd: nonEmptyText(record.cwd, 'cwd') }),
    ...(typeof record.enabled === 'boolean' ? { enabled: record.enabled } : {}),
    ...(typeof record.trusted === 'boolean' ? { trusted: record.trusted } : {}),
  });
});

const rendererUiActionInputCodec = defineRuntimeCodec<RuntimePluginUiActionInput>((value) => {
  const record = objectRecord(value, 'Plugin renderer UI action input must be an object.');
  const context = objectRecord(record.context, 'Plugin renderer UI action context must be an object.');
  const values = objectRecord(record.values, 'Plugin renderer UI action values must be an object.');
  const valueEntries = Object.entries(values);
  if (valueEntries.length > RUNTIME_PLUGIN_UI_LIMITS.fields) {
    throw new Error('Plugin renderer UI action contains too many values.');
  }
  const normalizedValues: Record<string, string> = {};
  for (const [key, item] of valueEntries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(key) || typeof item !== 'string') {
      throw new Error('Plugin renderer UI action value is invalid.');
    }
    if (item.length > RUNTIME_PLUGIN_UI_LIMITS.valueCharacters) {
      throw new Error('Plugin renderer UI action value is too large.');
    }
    normalizedValues[key] = item;
  }
  const surface = context.surface;
  if (surface !== 'renderer.chat.composer.status' && surface !== 'renderer.settings.page.extensions') {
    throw new Error('Plugin renderer UI action surface is invalid.');
  }
  return Object.freeze({
    pluginId: nonEmptyText(record.pluginId, 'pluginId'),
    actionId: nonEmptyText(record.actionId, 'actionId'),
    values: Object.freeze(normalizedValues),
    context: Object.freeze({
      contributionId: nonEmptyText(context.contributionId, 'contributionId'),
      surface,
      ...(context.threadId === undefined ? {} : { threadId: nonEmptyText(context.threadId, 'threadId') }),
    }),
  });
});

const rendererUiActionResultCodec = defineRuntimeCodec<RuntimePluginUiActionResult>((value) => {
  const record = objectRecord(value, 'Plugin renderer UI action result must be an object.');
  if (record.status !== 'completed') throw new Error('Plugin renderer UI action result is invalid.');
  return Object.freeze({ status: 'completed' });
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

const hookSnapshotCodec = defineRuntimeCodec<PluginManagementHookSnapshot>((value) => {
  const record = objectRecord(value, 'Plugin Hook snapshot must be an object.');
  return Object.freeze({
    hooks: Object.freeze(arrayValue(record.hooks, 'hooks').map(pluginManagementHook)),
  });
});

// Plugin adapters expose actionable validation and catalog messages as Error.
// Declare one stable boundary code so the Feature transport can preserve those
// messages without coupling contracts to adapter-specific error classes.
const pluginOperationErrors = Object.freeze({
  PLUGIN_OPERATION_FAILED: Object.freeze({ status: 500 }),
});

const pluginHookOperationErrors = Object.freeze({
  PLUGIN_HOOK_CHANGED: Object.freeze({ status: 409 }),
  PLUGIN_HOOK_NOT_MANAGEABLE: Object.freeze({ status: 409 }),
  PLUGIN_HOOK_NOT_FOUND: Object.freeze({ status: 404 }),
  PLUGIN_HOOK_NOT_STANDALONE: Object.freeze({ status: 409 }),
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

export const readPluginHooks = defineFeatureOperation({
  id: 'plugin-management.hooks.read',
  method: 'POST',
  path: '/v1/features/plugin-management/hooks/query',
  input: hookQueryCodec,
  output: hookSnapshotCodec,
  errors: Object.freeze({}),
  idempotency: 'safe',
});

export const setPluginHookState = defineFeatureOperation({
  id: 'plugin-management.hook-state.update',
  method: 'PATCH',
  path: '/v1/features/plugin-management/hooks/state',
  input: hookStateCodec,
  output: hookSnapshotCodec,
  errors: pluginHookOperationErrors,
  idempotency: 'idempotent',
});

export const deleteStandalonePluginHook = defineFeatureOperation({
  id: 'plugin-management.standalone-hook.delete',
  method: 'POST',
  path: '/v1/features/plugin-management/hooks/delete-standalone',
  input: hookTargetCodec,
  output: hookSnapshotCodec,
  errors: pluginHookOperationErrors,
  idempotency: 'idempotent',
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

export const runInstalledPluginRendererUiAction = defineFeatureOperation({
  id: 'plugin-management.renderer-ui-action.run',
  method: 'POST',
  path: '/v1/features/plugin-management/installed/:pluginId/renderer-ui/actions/:actionId',
  input: rendererUiActionInputCodec,
  output: rendererUiActionResultCodec,
  errors: pluginOperationErrors,
  idempotency: 'non-idempotent',
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

function pluginManagementHook(value: unknown): PluginManagementHook {
  const record = objectRecord(value, 'Plugin Hook must be an object.');
  return Object.freeze({
    command: nullableText(record.command, 'Hook command'),
    currentHash: nonEmptyText(record.currentHash, 'Hook currentHash'),
    displayOrder: nonNegativeInteger(record.displayOrder, 'Hook displayOrder'),
    enabled: booleanValue(record.enabled, 'Hook enabled'),
    eventName: hookEventName(record.eventName),
    handlerType: hookHandlerType(record.handlerType),
    isManaged: booleanValue(record.isManaged, 'Hook isManaged'),
    managementId: nonEmptyText(record.managementId, 'Hook managementId'),
    matcher: nullableText(record.matcher, 'Hook matcher'),
    ...(record.pluginHookId === undefined
      ? {}
      : { pluginHookId: nonEmptyText(record.pluginHookId, 'Hook pluginHookId') }),
    pluginId: nullableText(record.pluginId, 'Hook pluginId'),
    source: hookSource(record.source),
    statusMessage: nullableText(record.statusMessage, 'Hook statusMessage'),
    timeoutSec: nonNegativeInteger(record.timeoutSec, 'Hook timeoutSec'),
    trustStatus: hookTrustStatus(record.trustStatus),
  });
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

function optionalObjectRecord(value: unknown, message: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return objectRecord(value, message);
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

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Plugin management ${label} is invalid.`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Plugin management ${label} is invalid.`);
  }
  return value as number;
}

function hookEventName(value: unknown): RuntimeHookProtocolEventName {
  if (
    value === 'preToolUse'
    || value === 'permissionRequest'
    || value === 'postToolUse'
    || value === 'preCompact'
    || value === 'postCompact'
    || value === 'sessionStart'
    || value === 'userPromptSubmit'
    || value === 'subagentStart'
    || value === 'subagentStop'
    || value === 'stop'
  ) return value;
  throw new Error('Plugin management Hook eventName is invalid.');
}

function hookHandlerType(value: unknown): PluginManagementHook['handlerType'] {
  if (value === 'command' || value === 'prompt' || value === 'agent') return value;
  throw new Error('Plugin management Hook handlerType is invalid.');
}

function hookSource(value: unknown): RuntimeHookSource {
  if (
    value === 'system'
    || value === 'user'
    || value === 'project'
    || value === 'mdm'
    || value === 'sessionFlags'
    || value === 'plugin'
    || value === 'cloudRequirements'
    || value === 'cloudManagedConfig'
    || value === 'legacyManagedConfigFile'
    || value === 'legacyManagedConfigMdm'
    || value === 'unknown'
  ) return value;
  throw new Error('Plugin management Hook source is invalid.');
}

function hookTrustStatus(value: unknown): RuntimeHookTrustStatus {
  if (value === 'managed' || value === 'untrusted' || value === 'trusted' || value === 'modified') return value;
  throw new Error('Plugin management Hook trustStatus is invalid.');
}
