import type {
  RuntimeConfigState,
  RuntimeHookEventName,
  RuntimeHookMetadata,
} from '@setsuna-desktop/contracts';

type RuntimeHooksConfigDraft = NonNullable<RuntimeConfigState['hooks']>;

export type HookConfigLocation = {
  eventName: RuntimeHookEventName;
  eventKeyLabel: string;
  groupIndex: number;
  handlerIndex: number;
  sourcePath: string;
};

export function hookConfigLocation(hook: RuntimeHookMetadata): HookConfigLocation | null {
  const parts = hook.key.split(':');
  if (parts.length < 4) return null;
  const handlerIndex = Number(parts.at(-1));
  const groupIndex = Number(parts.at(-2));
  const eventKeyLabel = parts.at(-3);
  const sourcePath = parts.slice(0, -3).join(':');
  if (!Number.isInteger(groupIndex) || !Number.isInteger(handlerIndex) || !eventKeyLabel || !sourcePath) return null;
  return {
    eventName: hookConfigEventName(hook),
    eventKeyLabel,
    groupIndex,
    handlerIndex,
    sourcePath,
  };
}

export function deleteHookFromConfig(
  currentHooks: RuntimeHooksConfigDraft,
  location: HookConfigLocation,
): RuntimeHooksConfigDraft {
  const groups = (currentHooks[location.eventName] ?? []).map((group) => ({
    ...(group.matcher ? { matcher: group.matcher } : {}),
    hooks: group.hooks.map((handler) => ({ ...handler })),
  }));
  const targetGroup = groups[location.groupIndex];
  if (!targetGroup?.hooks[location.handlerIndex]) throw new Error('Hook no longer exists.');
  const removesGroup = targetGroup.hooks.length <= 1;

  if (removesGroup) {
    groups.splice(location.groupIndex, 1);
  } else {
    targetGroup.hooks.splice(location.handlerIndex, 1);
  }

  const nextHooks: RuntimeHooksConfigDraft = { ...currentHooks };
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

function parseHookStateKey(key: string): {
  eventKeyLabel: string;
  groupIndex: number;
  handlerIndex: number;
  prefix: string;
} | null {
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

function hookConfigEventName(hook: RuntimeHookMetadata): RuntimeHookEventName {
  switch (hook.eventName) {
    case 'preToolUse': return 'PreToolUse';
    case 'permissionRequest': return 'PermissionRequest';
    case 'postToolUse': return 'PostToolUse';
    case 'preCompact': return 'PreCompact';
    case 'postCompact': return 'PostCompact';
    case 'sessionStart': return 'SessionStart';
    case 'userPromptSubmit': return 'UserPromptSubmit';
    case 'subagentStart': return 'SubagentStart';
    case 'subagentStop': return 'SubagentStop';
    case 'stop': return 'Stop';
  }
}
