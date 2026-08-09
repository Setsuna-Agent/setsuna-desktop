import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimeHookListResponse,
  RuntimeHookMetadata,
  RuntimeHookState,
} from '@setsuna-desktop/contracts';
import { useCallback } from 'react';
import { deleteHookFromConfig, hookConfigLocation } from './runtimeHookConfig.js';

type HookManagementClient = Pick<DesktopRuntimeClient, 'saveConfig'>;

export function useRuntimeHookManagement({
  client,
  config,
  onConfigChange,
  refreshHooks,
}: {
  client: HookManagementClient;
  config: RuntimeConfigState | null;
  onConfigChange: (config: RuntimeConfigState) => void;
  refreshHooks: () => Promise<RuntimeHookListResponse>;
}) {
  const updateHookState = useCallback(async (
    hook: RuntimeHookMetadata,
    patch: { enabled?: boolean; trustedHash?: string | null },
  ) => {
    if (!config) throw new Error('Runtime config is not loaded.');
    const currentHooks = config.hooks ?? {};
    const state = { ...(currentHooks.state ?? {}) };
    const nextHookState: RuntimeHookState = { ...(state[hook.key] ?? {}) };
    if (patch.enabled !== undefined) nextHookState.enabled = patch.enabled;
    if ('trustedHash' in patch) {
      if (patch.trustedHash) nextHookState.trustedHash = patch.trustedHash;
      else delete nextHookState.trustedHash;
    }
    if (Object.keys(nextHookState).length) state[hook.key] = nextHookState;
    else delete state[hook.key];
    const hooks = { ...currentHooks };
    if (Object.keys(state).length) hooks.state = state;
    else delete hooks.state;
    const next = await client.saveConfig({ hooks });
    onConfigChange(next);
    await refreshHooks();
  }, [client, config, onConfigChange, refreshHooks]);

  const setHookTrust = useCallback(
    async (hook: RuntimeHookMetadata, trusted: boolean) => updateHookState(
      hook,
      { trustedHash: trusted ? hook.currentHash : null },
    ),
    [updateHookState],
  );

  const setHookEnabled = useCallback(
    async (hook: RuntimeHookMetadata, enabled: boolean) => updateHookState(hook, { enabled }),
    [updateHookState],
  );

  const deleteStandaloneHook = useCallback(async (hook: RuntimeHookMetadata) => {
    if (!config) throw new Error('Runtime config is not loaded.');
    if (hook.pluginId || hook.source !== 'user') throw new Error('Only standalone user Hooks can be deleted here.');
    const location = hookConfigLocation(hook);
    if (!location || location.sourcePath !== hook.sourcePath) throw new Error('Hook location is invalid.');
    const hooks = deleteHookFromConfig(config.hooks ?? {}, location);
    const next = await client.saveConfig({ hooks });
    onConfigChange(next);
    await refreshHooks();
  }, [client, config, onConfigChange, refreshHooks]);

  return { deleteStandaloneHook, setHookEnabled, setHookTrust };
}
