import type {
  RuntimeConfigState,
  RuntimeHookEventName,
  RuntimeHookListResponse,
  RuntimeHookState,
  RuntimeHooksConfig,
} from '@setsuna-desktop/contracts';
import type {
  PluginManagementHook,
  PluginManagementHookMutationResult,
  PluginManagementHookQuery,
  PluginManagementHookSnapshot,
  PluginManagementHookStateInput,
  PluginManagementHookTarget,
} from '@setsuna-desktop/feature-plugin-management/contracts';
import { createHash } from 'node:crypto';
import type { ConfigStore } from '../ports/config-store.js';
import {
  discoverRuntimeHooks,
  type RuntimeDiscoveredHook,
} from './runtime-hooks.js';

export class RuntimeHookManagement {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly configStore: ConfigStore) {}

  async listLegacy(cwds: readonly string[]): Promise<RuntimeHookListResponse> {
    const config = await this.configStore.getConfig();
    const discovery = discoverRuntimeHooks(config);
    return {
      data: cwds.map((cwd) => ({
        cwd,
        hooks: discovery.hooks.map(({
          configEventName: _configEventName,
          matcherEnabled: _matcherEnabled,
          ...hook
        }) => hook),
        warnings: discovery.warnings,
        errors: [],
      })),
    };
  }

  async list(_input: PluginManagementHookQuery): Promise<PluginManagementHookSnapshot> {
    const config = await this.configStore.getConfig();
    return hookSnapshot(config);
  }

  setState(input: PluginManagementHookStateInput): Promise<PluginManagementHookMutationResult> {
    return this.enqueueMutation(async () => {
      const config = await this.configStore.getConfig();
      const hook = managedHook(config, input);
      if (!hook) return { status: 'not-found' };
      if (hook.currentHash !== input.currentHash) return { status: 'changed' };
      if (input.trusted !== undefined && hook.isManaged) return { status: 'not-manageable' };

      const hooks = { ...(config.hooks ?? {}) };
      const state = { ...(hooks.state ?? {}) };
      const nextHookState: RuntimeHookState = { ...(state[hook.key] ?? {}) };
      if (input.enabled !== undefined) nextHookState.enabled = input.enabled;
      if (input.trusted !== undefined) {
        if (input.trusted) nextHookState.trustedHash = hook.currentHash;
        else delete nextHookState.trustedHash;
      }
      if (Object.keys(nextHookState).length) state[hook.key] = nextHookState;
      else delete state[hook.key];
      if (Object.keys(state).length) hooks.state = state;
      else delete hooks.state;

      const saved = await this.configStore.saveConfig({ hooks });
      return { status: 'updated', snapshot: hookSnapshot(saved) };
    });
  }

  deleteStandalone(input: PluginManagementHookTarget): Promise<PluginManagementHookMutationResult> {
    return this.enqueueMutation(async () => {
      const config = await this.configStore.getConfig();
      const hook = managedHook(config, input);
      if (!hook) return { status: 'not-found' };
      if (hook.currentHash !== input.currentHash) return { status: 'changed' };
      if (hook.pluginId || hook.source !== 'user') return { status: 'not-standalone' };
      const location = hookConfigLocation(hook);
      if (!location) return { status: 'not-found' };

      const hooks = deleteHookFromConfig(config.hooks ?? {}, location);
      const saved = await this.configStore.saveConfig({ hooks });
      return { status: 'updated', snapshot: hookSnapshot(saved) };
    });
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function hookSnapshot(config: RuntimeConfigState): PluginManagementHookSnapshot {
  return Object.freeze({
    hooks: Object.freeze(discoverRuntimeHooks(config).hooks.map(rendererHook)),
  });
}

function rendererHook(hook: RuntimeDiscoveredHook): PluginManagementHook {
  return Object.freeze({
    // Plugin commands contain managed install paths. Their manifest preview is the
    // renderer-safe source of truth; only standalone user commands are disclosed.
    command: hook.pluginId ? null : hook.command,
    currentHash: hook.currentHash,
    displayOrder: hook.displayOrder,
    enabled: hook.enabled,
    eventName: hook.eventName,
    handlerType: hook.handlerType,
    isManaged: hook.isManaged,
    managementId: hookManagementId(hook.key),
    matcher: hook.matcher,
    ...(hook.pluginHookId ? { pluginHookId: hook.pluginHookId } : {}),
    pluginId: hook.pluginId,
    source: hook.source,
    statusMessage: hook.statusMessage,
    timeoutSec: hook.timeoutSec,
    trustStatus: hook.trustStatus,
  });
}

function managedHook(
  config: RuntimeConfigState,
  input: Pick<PluginManagementHookTarget, 'managementId'>,
): RuntimeDiscoveredHook | undefined {
  return discoverRuntimeHooks(config).hooks.find((hook) => (
    hookManagementId(hook.key) === input.managementId
  ));
}

function hookManagementId(key: string): string {
  return createHash('sha256')
    .update('setsuna:plugin-management:hook\0')
    .update(key)
    .digest('hex');
}

type HookConfigLocation = Readonly<{
  eventName: RuntimeHookEventName;
  eventKeyLabel: string;
  groupIndex: number;
  handlerIndex: number;
}>;

function hookConfigLocation(hook: RuntimeDiscoveredHook): HookConfigLocation | null {
  const parsed = parseHookStateKey(hook.key);
  if (!parsed) return null;
  return {
    eventName: hook.configEventName,
    eventKeyLabel: parsed.eventKeyLabel,
    groupIndex: parsed.groupIndex,
    handlerIndex: parsed.handlerIndex,
  };
}

function deleteHookFromConfig(
  currentHooks: RuntimeHooksConfig,
  location: HookConfigLocation,
): RuntimeHooksConfig {
  const groups = (currentHooks[location.eventName] ?? []).map((group) => ({
    ...(group.matcher ? { matcher: group.matcher } : {}),
    hooks: group.hooks.map((handler) => ({ ...handler })),
  }));
  const targetGroup = groups[location.groupIndex];
  if (!targetGroup?.hooks[location.handlerIndex]) return currentHooks;
  const removesGroup = targetGroup.hooks.length <= 1;

  if (removesGroup) groups.splice(location.groupIndex, 1);
  else targetGroup.hooks.splice(location.handlerIndex, 1);

  const nextHooks: RuntimeHooksConfig = { ...currentHooks };
  if (groups.length) nextHooks[location.eventName] = groups;
  else delete nextHooks[location.eventName];

  const nextState = Object.fromEntries(Object.entries(nextHooks.state ?? {}).flatMap(([key, value]) => {
    const remappedKey = remapHookStateKey(key, location, removesGroup);
    return remappedKey ? [[remappedKey, value]] : [];
  }));
  if (Object.keys(nextState).length) nextHooks.state = nextState;
  else delete nextHooks.state;
  return nextHooks;
}

function remapHookStateKey(
  key: string,
  location: HookConfigLocation,
  removesGroup: boolean,
): string | null {
  const parsed = parseHookStateKey(key);
  if (!parsed || parsed.eventKeyLabel !== location.eventKeyLabel) return key;
  const { groupIndex, handlerIndex, prefix } = parsed;

  if (removesGroup) {
    if (groupIndex === location.groupIndex) return null;
    return groupIndex > location.groupIndex
      ? `${prefix}${groupIndex - 1}:${handlerIndex}`
      : key;
  }
  if (groupIndex !== location.groupIndex) return key;
  if (handlerIndex === location.handlerIndex) return null;
  return handlerIndex > location.handlerIndex
    ? `${prefix}${groupIndex}:${handlerIndex - 1}`
    : key;
}

function parseHookStateKey(key: string): Readonly<{
  eventKeyLabel: string;
  groupIndex: number;
  handlerIndex: number;
  prefix: string;
}> | null {
  const parts = key.split(':');
  if (parts.length < 4) return null;
  const handlerIndex = Number(parts.at(-1));
  const groupIndex = Number(parts.at(-2));
  const eventKeyLabel = parts.at(-3);
  const sourcePath = parts.slice(0, -3).join(':');
  if (!Number.isInteger(groupIndex) || !Number.isInteger(handlerIndex) || !eventKeyLabel || !sourcePath) return null;
  return {
    eventKeyLabel,
    groupIndex,
    handlerIndex,
    prefix: `${sourcePath}:${eventKeyLabel}:`,
  };
}
