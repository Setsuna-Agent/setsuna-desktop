import type {
  RuntimeHookEventName,
  RuntimeHookHandlerConfig,
  RuntimeHookMatcherGroup,
  RuntimeHooksConfig,
} from '@setsuna-desktop/contracts';

const HOOK_EVENT_NAMES: RuntimeHookEventName[] = [
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
];

export function normalizeHooksConfig(value: unknown): RuntimeHooksConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const hooks: RuntimeHooksConfig = {};
  for (const eventName of HOOK_EVENT_NAMES) {
    const groups = normalizeHookMatcherGroups(record[eventName]);
    if (groups.length) hooks[eventName] = groups;
  }
  const state = normalizeHookState(record.state);
  if (Object.keys(state).length) hooks.state = state;
  return hooks;
}

function normalizeHookMatcherGroups(value: unknown): RuntimeHookMatcherGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: RuntimeHookMatcherGroup[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const hooks = normalizeHookHandlers(record.hooks);
    if (!hooks.length) continue;
    const matcher = nonEmpty(record.matcher);
    groups.push({ ...(matcher ? { matcher } : {}), hooks });
  }
  return groups;
}

function normalizeHookHandlers(value: unknown): RuntimeHookHandlerConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const type = record.type;
      if (type !== 'command' && type !== 'prompt' && type !== 'agent') return null;
      const handler: RuntimeHookHandlerConfig = { type };
      const command = nonEmpty(record.command);
      if (command) handler.command = command;
      const commandWindows = nonEmpty(record.commandWindows ?? record.command_windows);
      if (commandWindows) handler.commandWindows = commandWindows;
      const timeout = positiveOptionalInt(record.timeoutSec ?? record.timeout_sec ?? record.timeout);
      if (timeout !== undefined) handler.timeoutSec = timeout;
      if (record.async === true) handler.async = true;
      const statusMessage = nonEmpty(record.statusMessage ?? record.status_message);
      if (statusMessage) handler.statusMessage = statusMessage;
      const pluginId = nonEmpty(record.pluginId ?? record.plugin_id);
      if (pluginId) handler.pluginId = pluginId;
      const pluginHookId = nonEmpty(record.pluginHookId ?? record.plugin_hook_id);
      if (pluginHookId) handler.pluginHookId = pluginHookId;
      const sourcePath = nonEmpty(record.sourcePath ?? record.source_path);
      if (sourcePath) handler.sourcePath = sourcePath;
      return handler;
    })
    .filter((item): item is RuntimeHookHandlerConfig => Boolean(item));
}

function normalizeHookState(value: unknown): NonNullable<RuntimeHooksConfig['state']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const state: NonNullable<RuntimeHooksConfig['state']> = {};
  for (const [key, rawState] of Object.entries(value)) {
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) continue;
    const record = rawState as Record<string, unknown>;
    const next = {
      enabled: booleanOrUndefined(record.enabled),
      trustedHash: nonEmpty(record.trustedHash ?? record.trusted_hash),
    };
    if (next.enabled !== undefined || next.trustedHash) state[key] = next;
  }
  return state;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveOptionalInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
