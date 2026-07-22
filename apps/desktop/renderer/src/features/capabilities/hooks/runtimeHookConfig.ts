import type {
  RuntimeConfigState,
  RuntimeHookEventName,
  RuntimeHookInput,
  RuntimeHookMatcherGroup,
  RuntimeHookMetadata,
} from '@setsuna-desktop/contracts';

type RuntimeHooksConfigDraft = NonNullable<RuntimeConfigState['hooks']>;
type RuntimeHookHandlerDraft = RuntimeHookMatcherGroup['hooks'][number];

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

export function updateHookInConfig(
  currentHooks: RuntimeHooksConfigDraft,
  location: HookConfigLocation,
  input: RuntimeHookInput,
): RuntimeHooksConfigDraft {
  if (location.eventName !== input.eventName) {
    const { hooks: removed } = removeHookAtLocation(currentHooks, location);
    const groups = removed[input.eventName] ?? [];
    return {
      ...removed,
      [input.eventName]: [...groups, hookInputToMatcherGroup(input)],
    };
  }

  const groups = cloneHookGroups(currentHooks[location.eventName] ?? []);
  const targetGroup = groups[location.groupIndex];
  const targetHandler = targetGroup?.hooks[location.handlerIndex];
  if (!targetGroup || !targetHandler) throw new Error('Hook no longer exists.');

  if (targetGroup.hooks.length === 1) {
    groups[location.groupIndex] = hookInputToMatcherGroup(input, targetHandler);
    return {
      ...currentHooks,
      [location.eventName]: groups,
    };
  }

  const remainingGroup: RuntimeHookMatcherGroup = {
    ...(targetGroup.matcher ? { matcher: targetGroup.matcher } : {}),
    hooks: targetGroup.hooks.filter((_handler, index) => index !== location.handlerIndex),
  };
  const nextGroups = groups.flatMap((group, index) => {
    if (index !== location.groupIndex) return [group];
    return [remainingGroup, hookInputToMatcherGroup(input, targetHandler)].filter((item) => item.hooks.length);
  });
  return cleanHookStateForEvent({
    ...currentHooks,
    [location.eventName]: nextGroups,
  }, location);
}

export function deleteHookFromConfig(
  currentHooks: RuntimeHooksConfigDraft,
  location: HookConfigLocation,
): RuntimeHooksConfigDraft {
  return removeHookAtLocation(currentHooks, location).hooks;
}

export function hookInputToMatcherGroup(input: RuntimeHookInput, fallback?: RuntimeHookHandlerDraft): RuntimeHookMatcherGroup {
  const matcher = hookUsesMatcher(input.eventName) ? input.matcher?.trim() : '';
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [hookInputToHandler(input, fallback)],
  };
}

function removeHookAtLocation(
  currentHooks: RuntimeHooksConfigDraft,
  location: HookConfigLocation,
): { hooks: RuntimeHooksConfigDraft } {
  const groups = cloneHookGroups(currentHooks[location.eventName] ?? []);
  const targetGroup = groups[location.groupIndex];
  if (!targetGroup || !targetGroup.hooks[location.handlerIndex]) throw new Error('Hook no longer exists.');

  if (targetGroup.hooks.length <= 1) {
    groups.splice(location.groupIndex, 1);
  } else {
    groups[location.groupIndex] = {
      ...(targetGroup.matcher ? { matcher: targetGroup.matcher } : {}),
      hooks: targetGroup.hooks.filter((_handler, index) => index !== location.handlerIndex),
    };
  }

  const nextHooks: RuntimeHooksConfigDraft = { ...currentHooks };
  if (groups.length) nextHooks[location.eventName] = groups;
  else delete nextHooks[location.eventName];

  return { hooks: cleanHookStateForEvent(nextHooks, location) };
}

function hookInputToHandler(input: RuntimeHookInput, fallback?: RuntimeHookHandlerDraft): RuntimeHookHandlerDraft {
  const commandWindows = input.commandWindows?.trim() || fallback?.commandWindows?.trim();
  const statusMessage = input.statusMessage?.trim();
  return {
    type: 'command',
    command: input.command.trim(),
    ...(commandWindows ? { commandWindows } : {}),
    ...(typeof input.timeoutSec === 'number' ? { timeoutSec: input.timeoutSec } : {}),
    ...(statusMessage ? { statusMessage } : {}),
  };
}

function cloneHookGroups(groups: RuntimeHookMatcherGroup[]): RuntimeHookMatcherGroup[] {
  return groups.map((group) => ({
    ...(group.matcher ? { matcher: group.matcher } : {}),
    hooks: group.hooks.map((handler) => ({ ...handler })),
  }));
}

function cleanHookStateForEvent(hooks: RuntimeHooksConfigDraft, location: HookConfigLocation): RuntimeHooksConfigDraft {
  const state = hooks.state ?? {};
  const prefix = `${location.sourcePath}:${location.eventKeyLabel}:`;
  const nextState = Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith(prefix)));
  const nextHooks: RuntimeHooksConfigDraft = { ...hooks };
  if (Object.keys(nextState).length) nextHooks.state = nextState;
  else delete nextHooks.state;
  return nextHooks;
}

function hookConfigEventName(hook: RuntimeHookMetadata): RuntimeHookEventName {
  switch (hook.eventName) {
    case 'preToolUse':
      return 'PreToolUse';
    case 'permissionRequest':
      return 'PermissionRequest';
    case 'postToolUse':
      return 'PostToolUse';
    case 'preCompact':
      return 'PreCompact';
    case 'postCompact':
      return 'PostCompact';
    case 'sessionStart':
      return 'SessionStart';
    case 'userPromptSubmit':
      return 'UserPromptSubmit';
    case 'subagentStart':
      return 'SubagentStart';
    case 'subagentStop':
      return 'SubagentStop';
    case 'stop':
      return 'Stop';
  }
}

function hookUsesMatcher(eventName: RuntimeHookEventName): boolean {
  return eventName !== 'UserPromptSubmit' && eventName !== 'Stop';
}
